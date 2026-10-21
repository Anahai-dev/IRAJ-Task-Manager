import { Router } from "express";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import { R } from "../runtime.ts";
import { getAppUrl } from "../config.ts";
import { hashPassword, isValidEmail, isValidPassword, verifyPassword } from "../auth/passwords.ts";
import { signAuthToken, verifyAuthToken } from "../auth/jwt.ts";
import { clearAuthCookie, setAuthCookie } from "../auth/cookies.ts";
import {
  createSignedOAuthState,
  getSafeOAuthRedirectUri,
  resolveOAuthUser,
  verifyOAuthState,
} from "../auth/oauth.ts";
import { escapeHtml, safeJsonForScriptTag } from "../html.ts";
import { parseJsonField, resolveUserPermissions } from "../rbac.ts";

function oauthSuccessHtml(nonce: string, user: { id: string; name: string; email: string; role: string }): string {
  const userPayload = safeJsonForScriptTag(user);
  return `
      <!DOCTYPE html>
      <html>
        <body>
          <script nonce="${nonce}">
            if (window.opener) {
              window.opener.postMessage({
                type: 'OAUTH_AUTH_SUCCESS',
                user: ${userPayload}
              }, window.location.origin);
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. Closing...</p>
        </body>
      </html>
    `;
}

function oauthErrorHtml(nonce: string, title: string, message: string, hint: string, closeDelayMs: number): string {
  return `
      <!DOCTYPE html>
      <html><body>
        <p>${escapeHtml(title)}: ${escapeHtml(message)}</p>
        <p>${escapeHtml(hint)}</p>
        <script nonce="${nonce}">setTimeout(() => window.close(), ${closeDelayMs});</script>
      </body></html>
    `;
}

export function authRouter(): Router {
  const router = Router();

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      let { name, email, password } = req.body as { name?: unknown; email?: unknown; password?: unknown };
      const config = R().config;

      if (!name || typeof name !== "string" || name.trim() === "") {
        res.status(400).json({ error: "Name is required and must be a valid string." });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: "A valid email address is required." });
        return;
      }
      if (!isValidPassword(password, config.auth.passwordMinLength)) {
        res.status(400).json({ error: `Password must be at least ${config.auth.passwordMinLength} characters long.` });
        return;
      }

      email = email.toLowerCase().trim();
      const db = await R().getDb();

      try {
        const result = await db.transaction(async (tx) => {
          const existing = await tx.get<Record<string, unknown>>("SELECT * FROM users WHERE email = ?", email);
          if (existing) {
            if (
              existing.authProvider === "local" &&
              (existing.emailVerified === 0 || existing.emailVerified === false)
            ) {
              const cooldownAgo = new Date(Date.now() - config.auth.pendingRegistrationCooldownMs).toISOString();
              if (existing.createdAt && String(existing.createdAt) > cooldownAgo) {
                throw new Error("Email is already registered and pending verification. Please wait 24 hours before re-registering.");
              }
              await tx.run("DELETE FROM users WHERE id = ?", existing.id);
            } else {
              throw new Error("Email already exists");
            }
          }

          const userCount = await tx.get<{ count: number | string }>("SELECT COUNT(*) as count FROM users");
          const isFirstUser = parseInt(String(userCount?.count ?? 0), 10) === 0;
          if (!isFirstUser && !config.registration.allowPublicRegister) {
            throw new Error("REGISTRATION_DISABLED");
          }

          const passwordHash = await hashPassword(password, config.auth.bcryptRounds);
          const id = uuidv4();
          const createdAt = new Date().toISOString();
          const assignedRole = isFirstUser ? "super_admin" : "developer";
          const emailVerified = isFirstUser ? 1 : 0;

          await tx.run(
            "INSERT INTO users (id, name, email, passwordHash, role, tokenVersion, authProvider, emailVerified, status, createdAt) VALUES (?, ?, ?, ?, ?, 1, 'local', ?, 'Available', ?)",
            [id, name, email, passwordHash, assignedRole, emailVerified, createdAt]
          );

          return { id, name, email, role: assignedRole, emailVerified };
        });

        if (result.emailVerified === 1) {
          const token = signAuthToken(
            { id: result.id, role: result.role, tokenVersion: 1 },
            config.security.secretKey,
            config.auth.jwt.expiresIn,
            config.auth.jwt.algorithm
          );
          setAuthCookie(res, token, config.auth.cookie);
          res.json({ user: { id: result.id, name: result.name, email: result.email, role: result.role, rolePrefix: "" } });
          return;
        }
        res.json({
          message:
            "Registration successful. Please contact an administrator or use 'Forgot Password' to verify your email address before logging in.",
          requiresVerification: true,
        });
      } catch (e: unknown) {
        const message = String((e as { message?: string })?.message || "");
        if (message === "REGISTRATION_DISABLED") {
          res.status(403).json({
            error: "Public registration is disabled. Ask an administrator to create your account.",
          });
          return;
        }
        if (message.includes("Email already") || message.includes("pending verification")) {
          res.status(400).json({ error: message });
          return;
        }
        console.error("REGISTER ERROR:", e);
        res.status(500).json({ error: "An unexpected error occurred during registration." });
      }
    })
  );

  router.get(
    "/verify-email",
    asyncHandler(async (req, res) => {
      const token = req.query.token;
      if (!token || typeof token !== "string") {
        res.status(400).send("<h3>Invalid verification link.</h3>");
        return;
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const db = await R().getDb();
      const record = await db.get<{ userId: string; expiresAt: number }>(
        "SELECT * FROM email_verifications WHERE token = ?",
        tokenHash
      );
      if (!record || record.expiresAt < Date.now()) {
        if (record) {
          await db.run("DELETE FROM email_verifications WHERE token = ?", tokenHash);
        }
        res.status(400).send("<h3>Verification link is invalid or has expired. Please register again.</h3>");
        return;
      }
      await db.run("UPDATE users SET emailVerified = 1 WHERE id = ?", record.userId);
      await db.run("DELETE FROM email_verifications WHERE token = ?", tokenHash);
      res.redirect("/login?verified=true");
    })
  );

  router.post(
    "/verify-email",
    asyncHandler(async (req, res) => {
      const { token } = req.body as { token?: unknown };
      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "Verification token is required." });
        return;
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const db = await R().getDb();
      const record = await db.get<{ userId: string; expiresAt: number }>(
        "SELECT * FROM email_verifications WHERE token = ?",
        tokenHash
      );
      if (!record || record.expiresAt < Date.now()) {
        if (record) {
          await db.run("DELETE FROM email_verifications WHERE token = ?", tokenHash);
        }
        res.status(400).json({ error: "Invalid or expired verification token." });
        return;
      }
      await db.run("UPDATE users SET emailVerified = 1 WHERE id = ?", record.userId);
      await db.run("DELETE FROM email_verifications WHERE token = ?", tokenHash);
      res.json({ success: true, message: "Email verified successfully." });
    })
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      let { email, password } = req.body as { email?: unknown; password?: unknown };
      if (!email || typeof email !== "string" || email.trim() === "") {
        res.status(400).json({ error: "Email is required." });
        return;
      }
      if (!password || typeof password !== "string" || password.trim() === "") {
        res.status(400).json({ error: "Password is required." });
        return;
      }
      email = email.toLowerCase().trim();
      const db = await R().getDb();
      const user = await db.get<Record<string, unknown>>("SELECT * FROM users WHERE email = ? ", email);
      if (!user) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      if (user.status && ["inactive", "disabled", "suspended"].includes(String(user.status).toLowerCase())) {
        res.status(403).json({ error: "Account is inactive or disabled. Contact administrator." });
        return;
      }
      if (user.emailVerified === 0 || user.emailVerified === false) {
        res.status(403).json({
          error: "Email address is not verified. Please verify your account or contact an administrator before logging in.",
        });
        return;
      }
      const isMatch = await verifyPassword(password, String(user.passwordHash));
      if (!isMatch) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      const tokenVersion = Number(user.tokenVersion || 1);
      const token = signAuthToken(
        { id: String(user.id), role: String(user.role), tokenVersion },
        R().config.security.secretKey,
        R().config.auth.jwt.expiresIn,
        R().config.auth.jwt.algorithm
      );
      setAuthCookie(res, token, R().config.auth.cookie);
      res.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          rolePrefix: user.rolePrefix || "",
        },
      });
    })
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      try {
        const authHeader = req.headers.authorization;
        const rawBearer = authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
        const cookieToken = req.cookies?.[R().config.auth.cookie.name];
        const token =
          rawBearer && rawBearer !== "cookie_authenticated" && rawBearer !== "null" ? rawBearer : cookieToken;
        if (token) {
          try {
            const decoded = verifyAuthToken(token, R().config.security.secretKey, R().config.auth.jwt.algorithm);
            if (decoded?.id) {
              const db = await R().getDb();
              await db.run("UPDATE users SET tokenVersion = COALESCE(tokenVersion, 1) + 1 WHERE id = ?", decoded.id);
            }
          } catch {
            // Ignore token verification errors during logout
          }
        }
      } catch (e) {
        console.error("LOGOUT ERROR:", e);
      } finally {
        clearAuthCookie(res, R().config.auth.cookie);
        res.json({ success: true, message: "Logged out successfully" });
      }
    })
  );

  router.post(
    "/forgot-password",
    asyncHandler(async (req, res) => {
      let { email } = req.body as { email?: unknown };
      if (!email || typeof email !== "string" || email.trim() === "") {
        res.status(400).json({ error: "A valid email is required." });
        return;
      }
      email = email.toLowerCase().trim();
      const db = await R().getDb();
      const user = await db.get<{ id: string; email: string }>("SELECT * FROM users WHERE email = ? ", email);
      const generic = { message: "If that email is registered, a password reset link has been sent." };
      if (!user) {
        res.json(generic);
        return;
      }
      const resetToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
      const expiresAt = Date.now() + R().config.auth.passwordResetTtlMs;
      await db.run("DELETE FROM password_resets WHERE userId = ?", user.id);
      await db.run("INSERT INTO password_resets (token, userId, expiresAt) VALUES (?, ?, ?)", [tokenHash, user.id, expiresAt]);
      const baseUrl = getAppUrl(req, R().config);
      const resetLink = `${baseUrl}/reset-password/${resetToken}`;

      const mail = R().config.mail;
      if (mail.configured) {
        const transporter = nodemailer.createTransport({
          host: mail.host,
          port: mail.port,
          secure: mail.secure,
          auth: {
            user: mail.user,
            pass: mail.pass,
          },
        });
        await transporter.sendMail({
          from: mail.from,
          to: user.email,
          subject: "Password Reset Request",
          text: `You requested a password reset. Click this link to reset your password: ${resetLink}\n\nIf you did not request this, please ignore this email.`,
          html: `<p>You requested a password reset.</p><p><a href="${resetLink}">Click here to reset your password</a></p><p>If you did not request this, please ignore this email.</p>`,
        });
        res.json(generic);
        return;
      }

      if (!R().config.isProduction) {
        console.log(`[DEV MODE] Password reset link for ${email}: ${resetLink}`);
      } else {
        console.error("SMTP is not configured; password reset email was not sent.");
      }
      res.json(generic);
    })
  );

  router.post(
    "/reset-password",
    asyncHandler(async (req, res) => {
      const { token, newPassword } = req.body as { token?: unknown; newPassword?: unknown };
      if (!token || typeof token !== "string") {
        res.status(400).json({ error: "Invalid token." });
        return;
      }
      if (!isValidPassword(newPassword, R().config.auth.passwordMinLength)) {
        res.status(400).json({ error: `New password must be at least ${R().config.auth.passwordMinLength} characters long.` });
        return;
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const db = await R().getDb();
      const resetRecord = await db.get<{ userId: string; expiresAt: number }>(
        "SELECT * FROM password_resets WHERE token = ?",
        tokenHash
      );
      if (!resetRecord || resetRecord.expiresAt < Date.now()) {
        if (resetRecord) await db.run("DELETE FROM password_resets WHERE token = ?", tokenHash);
        res.status(400).json({ error: "Invalid or expired reset token." });
        return;
      }
      const hash = await hashPassword(newPassword, R().config.auth.bcryptRounds);
      await db.run(
        "UPDATE users SET passwordHash = ?, tokenVersion = COALESCE(tokenVersion, 1) + 1, emailVerified = 1 WHERE id = ?",
        [hash, resetRecord.userId]
      );
      await db.run("DELETE FROM password_resets WHERE userId = ?", resetRecord.userId);
      res.json({ message: "Password has been successfully reset" });
    })
  );

  router.get("/gitlab/url", (req, res) => {
    const redirectUri = getSafeOAuthRedirectUri(req, "gitlab", R().config);
    const oauth = R().config.oauth;
    const state = createSignedOAuthState("gitlab", redirectUri, R().config.security.secretKey);
    const params = new URLSearchParams({
      client_id: oauth.gitlab.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "read_user",
      state,
    });
    res.json({ url: `${oauth.gitlabUrl}/oauth/authorize?${params.toString()}` });
  });

  router.get(
    "/gitlab/callback",
    asyncHandler(async (req, res) => {
      const { code, state } = req.query;
      const oauth = R().config.oauth;
      const gitlabUrl = oauth.gitlabUrl;
      const clientId = oauth.gitlab.clientId;
      const clientSecret = oauth.gitlab.clientSecret;
      const nonce = String(res.locals.cspNonce || "");
      try {
        const db = await R().getDb();
        const redirectUri = await verifyOAuthState(db, req, "gitlab", state, R().config.security.secretKey, R().config);
        if (!code) throw new Error("No authorization code provided");
        if (!clientId) throw new Error("GITLAB_CLIENT_ID not configured");
        const tokenRes = await fetch(`${gitlabUrl}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });
        const tokenData = (await tokenRes.json()) as { access_token?: string; error_description?: string };
        if (!tokenRes.ok) throw new Error(tokenData.error_description || "Failed to get token");
        const userRes = await fetch(`${gitlabUrl}/api/v4/user`, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = (await userRes.json()) as {
          state?: string;
          email?: string;
          name?: string;
          username?: string;
          confirmed_at?: string;
        };
        if (!userRes.ok) throw new Error("Failed to get user data");
        if (userData.state && userData.state !== "active") throw new Error("GitLab account is inactive or blocked.");
        if (!userData.email) {
          throw new Error("GitLab account has no email address. Please make sure your email is verified and public on GitLab.");
        }
        let isEmailConfirmed = !!userData.confirmed_at;
        try {
          const glEmailsRes = await fetch(`${gitlabUrl}/api/v4/user/emails`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (glEmailsRes.ok) {
            const glEmails = (await glEmailsRes.json()) as Array<{ email?: string; confirmed_at?: string }>;
            if (Array.isArray(glEmails)) {
              const match = glEmails.find((e) => e.email && e.email.toLowerCase() === userData.email!.toLowerCase());
              if (match && match.confirmed_at) isEmailConfirmed = true;
            }
          }
        } catch {
          // GitLab emails endpoint is optional; confirmed_at on the user is enough
        }
        if (!isEmailConfirmed) {
          throw new Error("GitLab account email is not confirmed. Please confirm your email on GitLab before signing in.");
        }
        const user = await resolveOAuthUser(
          db,
          {
            email: userData.email,
            name: userData.name || userData.username || "GitLab User",
            provider: "gitlab",
          },
          { autoProvision: oauth.autoProvision, allowedDomains: [...oauth.allowedDomains], bcryptRounds: R().config.auth.bcryptRounds }
        );
        const token = signAuthToken(
          { id: user.id, role: user.role, tokenVersion: user.tokenVersion || 1 },
          R().config.security.secretKey,
          R().config.auth.jwt.expiresIn,
          R().config.auth.jwt.algorithm
        );
        setAuthCookie(res, token, R().config.auth.cookie);
        res.send(oauthSuccessHtml(nonce, { id: user.id, name: user.name, email: user.email, role: user.role }));
      } catch (e: unknown) {
        console.error("GitLab OAuth error:", e);
        res.send(
          oauthErrorHtml(
            nonce,
            "OAuth Error",
            (e as Error).message,
            "Ensure GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET are configured.",
            R().config.oauth.errorPageCloseDelayMs
          )
        );
      }
    })
  );

  router.get("/google/url", (req, res) => {
    const redirectUri = getSafeOAuthRedirectUri(req, "google", R().config);
    const oauth = R().config.oauth;
    const state = createSignedOAuthState("google", redirectUri, R().config.security.secretKey);
    const params = new URLSearchParams({
      client_id: oauth.google.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  });

  router.get(
    ["/google/callback", "/google/callback/"],
    asyncHandler(async (req, res) => {
      const { code, state } = req.query;
      const oauth = R().config.oauth;
      const clientId = oauth.google.clientId;
      const clientSecret = oauth.google.clientSecret;
      const nonce = String(res.locals.cspNonce || "");
      try {
        const db = await R().getDb();
        const redirectUri = await verifyOAuthState(db, req, "google", state, R().config.security.secretKey, R().config);
        if (!code) throw new Error("No authorization code provided");
        if (!clientId) throw new Error("GOOGLE_CLIENT_ID not configured");
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });
        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          error_description?: string;
          error?: string;
        };
        if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || "Failed to get token");
        const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = (await userRes.json()) as {
          email?: string;
          email_verified?: boolean | string;
          name?: string;
          given_name?: string;
        };
        if (!userRes.ok) throw new Error("Failed to get user data");
        if (!userData.email) throw new Error("Google account has no email address.");
        if (userData.email_verified !== true && userData.email_verified !== "true") {
          throw new Error("Google account email is not verified.");
        }
        const user = await resolveOAuthUser(
          db,
          {
            email: userData.email,
            name: userData.name || userData.given_name || "Google User",
            provider: "google",
          },
          { autoProvision: oauth.autoProvision, allowedDomains: [...oauth.allowedDomains], bcryptRounds: R().config.auth.bcryptRounds }
        );
        const token = signAuthToken(
          { id: user.id, role: user.role, tokenVersion: user.tokenVersion || 1 },
          R().config.security.secretKey,
          R().config.auth.jwt.expiresIn,
          R().config.auth.jwt.algorithm
        );
        setAuthCookie(res, token, R().config.auth.cookie);
        res.send(oauthSuccessHtml(nonce, { id: user.id, name: user.name, email: user.email, role: user.role }));
      } catch (e: unknown) {
        console.error("Google OAuth error:", e);
        res.send(
          oauthErrorHtml(
            nonce,
            "Google OAuth Error",
            (e as Error).message,
            "Ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are configured in the environment variables.",
            R().config.oauth.errorPageCloseDelayMs
          )
        );
      }
    })
  );

  router.get("/github/url", (req, res) => {
    const redirectUri = getSafeOAuthRedirectUri(req, "github", R().config);
    const oauth = R().config.oauth;
    const state = createSignedOAuthState("github", redirectUri, R().config.security.secretKey);
    const params = new URLSearchParams({
      client_id: oauth.github.clientId,
      redirect_uri: redirectUri,
      scope: "user:email",
      state,
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  });

  router.get(
    ["/github/callback", "/github/callback/"],
    asyncHandler(async (req, res) => {
      const { code, state } = req.query;
      const oauth = R().config.oauth;
      const clientId = oauth.github.clientId;
      const clientSecret = oauth.github.clientSecret;
      const nonce = String(res.locals.cspNonce || "");
      try {
        const db = await R().getDb();
        const redirectUri = await verifyOAuthState(db, req, "github", state, R().config.security.secretKey, R().config);
        if (!code) throw new Error("No authorization code provided");
        if (!clientId) throw new Error("GITHUB_CLIENT_ID not configured");
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }),
        });
        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          error?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || tokenData.error) {
          throw new Error(tokenData.error_description || tokenData.error || "Failed to get token");
        }
        const userRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "iraj-task-manager" },
        });
        const userData = (await userRes.json()) as { name?: string; login?: string };
        if (!userRes.ok) throw new Error("Failed to get user data from GitHub");
        let email: string | null = null;
        const emailsRes = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "iraj-task-manager" },
        });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as Array<{ email: string; primary?: boolean; verified?: boolean }>;
          const verifiedPrimary = emails.find((e) => e.primary && e.verified);
          const verifiedAny = emails.find((e) => e.verified);
          email = verifiedPrimary?.email || verifiedAny?.email || null;
        }
        if (!email) {
          throw new Error(
            "GitHub account has no verified email address. Please make sure your primary email is verified on GitHub."
          );
        }
        const user = await resolveOAuthUser(
          db,
          { email, name: userData.name || userData.login || "GitHub User", provider: "github" },
          { autoProvision: oauth.autoProvision, allowedDomains: [...oauth.allowedDomains], bcryptRounds: R().config.auth.bcryptRounds }
        );
        const token = signAuthToken(
          { id: user.id, role: user.role, tokenVersion: user.tokenVersion || 1 },
          R().config.security.secretKey,
          R().config.auth.jwt.expiresIn,
          R().config.auth.jwt.algorithm
        );
        setAuthCookie(res, token, R().config.auth.cookie);
        res.send(oauthSuccessHtml(nonce, { id: user.id, name: user.name, email: user.email, role: user.role }));
      } catch (e: unknown) {
        console.error("GitHub OAuth error:", e);
        res.send(
          oauthErrorHtml(
            nonce,
            "GitHub OAuth Error",
            (e as Error).message,
            "Ensure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are configured in the environment variables.",
            R().config.oauth.errorPageCloseDelayMs
          )
        );
      }
    })
  );

  router.get(
    "/me",
    R().authenticateToken,
    asyncHandler(async (req, res) => {
      const db = await R().getDb();
      const user = await db.get<{
        id: string;
        name: string;
        email: string;
        role: string;
        skills: string | null;
        rolePrefix: string | null;
        status: string | null;
      }>("SELECT id, name, email, role, skills, rolePrefix, status FROM users WHERE id = ?", req.user!.id);
      if (!user) {
        res.sendStatus(404);
        return;
      }
      const permissions = await resolveUserPermissions(db, user);
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        skills: parseJsonField<string[]>(user.skills, []),
        rolePrefix: user.rolePrefix || "",
        status: user.status || "Available",
        permissions,
      });
    })
  );

  return router;
}
