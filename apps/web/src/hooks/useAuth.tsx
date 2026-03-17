import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { apiPost, apiFetch } from "@/lib/api";

interface AuthUser {
  user_id: string;
  username: string;
  email: string;
  full_name: string;
  user_type: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("intellirag_token"));
  const [isLoading, setIsLoading] = useState(!!token);

  useEffect(() => {
    if (!token) return;
    apiFetch<AuthUser>("/api/v1/users/me")
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("intellirag_token");
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiPost<{ token: string; user: AuthUser }>("/api/v1/auth/login", { username, password });
    localStorage.setItem("intellirag_token", result.token);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("intellirag_token");
    setToken(null);
    setUser(null);
  }, []);

  const isAdmin = user?.user_type === "ADMIN";

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
