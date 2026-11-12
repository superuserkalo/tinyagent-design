import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";
import { TooltipProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "TinyAgent Design",
  description: "Describe a 3D scene and an agent builds it on WebGPU as one HTML file, live. The agent loop runs in your browser on the TinyAgent SDK.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#090909" },
  ],
};

// Saved pane sizes apply while the HTML parses, so nothing jumps after hydration.
const PANES = `try{var s=localStorage,r=document.documentElement,a=Number(s.getItem("ta-agent-width"));if(a>=320&&a<=640)r.style.setProperty("--agent-width",a+"px");var b=Number(s.getItem("ta-sidebar-width"));if(b>=224&&b<=320)r.style.setProperty("--sidebar-width",b+"px");if(s.getItem("ta-sidebar-collapsed")==="1")r.classList.add("sidebar-collapsed")}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: PANES }} />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
