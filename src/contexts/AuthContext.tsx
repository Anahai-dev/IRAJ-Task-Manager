import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "../types";
import { apiGet, apiPost, apiPut } from "../lib/api";

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (newToken: string | undefined, newUser: User) => void;
  logout: () => void;
  updateUser: (user: User) => void;
  loading: boolean;
  settings: Record<string, string>;
  refreshSettings: () => Promise<void>;
  updateSettings: (newSettings: Record<string, string>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Record<string, string>>({
    manager_prefix: "Engineering",
    developer_prefix: "Lead"
  });

  // Clean up legacy tokens in localStorage if present
  const cleanupLocalStorage = () => {
    try {
      if (localStorage.getItem("token")) {
        localStorage.removeItem("token");
      }
    } catch (e) {
      // ignore
    }
  };

  const refreshSettings = async () => {
    try {
      const data = await apiGet<Record<string, string>>('/api/settings');
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const updateSettings = async (newSettings: Record<string, string>) => {
    try {
      const data = await apiPut<Record<string, string>>('/api/settings', newSettings);
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Failed to update settings");
    }
  };

  // Fetch current user using httpOnly cookie on mount
  useEffect(() => {
    cleanupLocalStorage();
    setLoading(true);
    apiGet<User>('/api/auth/me', {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
    })
      .then((data) => {
        setUser(data);
        refreshSettings();
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = (_newToken: string | undefined, newUser: User) => {
    cleanupLocalStorage();
    setUser(newUser);
    refreshSettings();
  };

  const logout = () => {
    cleanupLocalStorage();
    setUser(null);
    void apiPost('/api/auth/logout').catch((err) => console.error("Logout request error:", err));
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  // Provide a non-null placeholder string when logged in to preserve component checks (if (token))
  const token = user ? "cookie_authenticated" : null;

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, loading, settings, refreshSettings, updateSettings }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
