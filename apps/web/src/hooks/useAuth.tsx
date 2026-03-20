import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { apiPost, buildApiUrl } from "@/lib/api";

interface AuthUser {
  user_id: string;
  username: string;
  email: string;
  full_name: string;
  user_type: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    localStorage.removeItem("intellirag_token");

    async function bootstrapAuth() {
      try {
        const res = await fetch(buildApiUrl("/api/v1/users/me"), { credentials: "include" });
        if (!res.ok) {
          if (res.status !== 401) {
            throw new Error(`Failed to load current user (${res.status})`);
          }
          if (!cancelled) setUser(null);
          return;
        }
        const currentUser = await res.json() as AuthUser | null;
        if (!cancelled) setUser(currentUser);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void bootstrapAuth();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiPost<{ user: AuthUser }>("/api/v1/auth/login", { username, password });
    localStorage.removeItem("intellirag_token");
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost<{ success: boolean }>("/api/v1/auth/logout", {});
    } catch {
      // Clear local auth state even if logout confirmation fails.
    }
    localStorage.removeItem("intellirag_token");
    setUser(null);
  }, []);

  const isAdmin = user?.user_type === "ADMIN";

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
