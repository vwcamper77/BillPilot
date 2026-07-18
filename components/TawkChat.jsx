"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const TAWK_SCRIPT_ID = "tawk-to-chat";
const TAWK_SCRIPT_URL = "https://embed.tawk.to/6a5bdbd7aa83a11d48ca4906/1jtrd5gq4";
const PRIVATE_ROUTE_PREFIXES = ["/dashboard", "/admin"];

function isPrivateRoute(pathname) {
  return PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default function TawkChat() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    if (isPrivateRoute(pathname)) {
      if (window.Tawk_API) {
        window.Tawk_API.onLoad = () => {
          if (isPrivateRoute(pathnameRef.current)) {
            window.Tawk_API?.hideWidget?.();
          }
        };
      }
      window.Tawk_API?.hideWidget?.();
      return undefined;
    }

    if (window.Tawk_API?.showWidget) {
      window.Tawk_API.showWidget();
      return () => window.Tawk_API?.hideWidget?.();
    }

    const timeoutId = window.setTimeout(() => {
      if (document.getElementById(TAWK_SCRIPT_ID)) {
        return;
      }

      window.Tawk_API = window.Tawk_API || {};
      window.Tawk_LoadStart = new Date();
      window.Tawk_API.onLoad = () => {
        if (isPrivateRoute(pathnameRef.current)) {
          window.Tawk_API?.hideWidget?.();
        }
      };

      const script = document.createElement("script");
      script.id = TAWK_SCRIPT_ID;
      script.async = true;
      script.src = TAWK_SCRIPT_URL;
      script.charset = "UTF-8";
      script.setAttribute("crossorigin", "*");
      document.head.appendChild(script);
    }, 10000);

    return () => {
      window.clearTimeout(timeoutId);
      window.Tawk_API?.hideWidget?.();
    };
  }, [pathname]);

  return null;
}
