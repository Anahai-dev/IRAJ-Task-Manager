import React from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

interface SafeMarkdownProps {
  children: string;
  className?: string;
}

/** Renders user-authored markdown with HTML stripped and rehype-sanitize applied. */
export default function SafeMarkdown({ children, className }: SafeMarkdownProps) {
  const markdown = (
    <Markdown skipHtml rehypePlugins={[rehypeSanitize]}>
      {children}
    </Markdown>
  );

  if (className) {
    return <div className={className}>{markdown}</div>;
  }

  return markdown;
}
