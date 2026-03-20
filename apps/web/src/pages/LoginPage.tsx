import { useState, useEffect, useRef, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ThemeSelector } from "@/components/ThemeSelector";
import { Eye, EyeOff, Loader2, AlertCircle, Info, User, Lock } from "lucide-react";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("intellirag_remember") === "true");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const logoColorStyle = { color: "var(--color-logo-accent)" } as const;

  // Auto-focus username field and restore remembered username on mount only
  useEffect(() => {
    if (localStorage.getItem("intellirag_remember") === "true") {
      const saved = localStorage.getItem("intellirag_remembered_user");
      if (saved) setUsername(saved);
    }
    usernameRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!username.trim()) {
      setError("Please enter your username.");
      usernameRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      passwordRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      if (rememberMe) {
        localStorage.setItem("intellirag_remember", "true");
        localStorage.setItem("intellirag_remembered_user", username.trim());
      } else {
        localStorage.removeItem("intellirag_remember");
        localStorage.removeItem("intellirag_remembered_user");
      }
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please check your credentials and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-skin-base">
      {/* Screen reader live region for error announcements */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {error}
      </div>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          {/* Branding */}
          <div className="text-center">
            <div className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center mb-6 shadow-lg bg-surface border border-skin">
              <svg width="48" height="48" viewBox="0 0 32 32" fill="none" aria-hidden="true" style={logoColorStyle}>
                <path d="M16 2L4 8v8c0 7.73 5.12 14.96 12 16 6.88-1.04 12-8.27 12-16V8L16 2z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="16" cy="14" r="5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M13.5 14c0-1.38 1.12-2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M16 19v3M12 22h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: "'Poppins', sans-serif" }}>
              <span className="text-[var(--color-logo-accent)]">ADS</span>{" "}
              <span className="text-skin-base">Knowledge Agent</span>
            </h1>
            <p className="mt-2 text-sm text-skin-muted">
              Intelligent document search &amp; analysis
            </p>
          </div>

          {/* Login card */}
          <div className="rounded-2xl shadow-xl p-6 sm:p-8 bg-surface border border-skin">
            {/* Info banner (e.g. forgot password) */}
            {info && (
              <div
                role="status"
                className="mb-6 flex items-start gap-3 text-sm px-4 py-3 rounded-xl bg-primary-50 border border-primary-200 text-primary-700"
              >
                <Info size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>{info}</span>
              </div>
            )}

            {/* Error alert */}
            {error && (
              <div
                id="login-error"
                role="alert"
                className="mb-6 flex items-start gap-3 text-sm px-4 py-3 rounded-xl border bg-[rgb(var(--color-danger-soft))] border-[rgb(var(--color-danger-border))] text-[rgb(var(--color-danger))]"
              >
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Username field */}
              <div>
                <label htmlFor="login-username" className="block text-sm font-medium mb-1.5 text-skin-base">
                  Username
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <User size={18} className="text-skin-muted" aria-hidden="true" />
                  </div>
                  <input
                    ref={usernameRef}
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={256}
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); if (error) setError(""); }}
                    placeholder="Enter your username"
                    aria-invalid={!!error && error.toLowerCase().includes("username")}
                    aria-describedby={error ? "login-error" : undefined}
                    className="w-full pl-10 pr-3 py-2.5 border border-skin rounded-xl text-base outline-none transition-colors
                      focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500
                      bg-surface-alt text-skin-base placeholder:text-skin-muted"
                    required
                  />
                </div>
              </div>

              {/* Password field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-sm font-medium text-skin-base">
                    Password
                  </label>
                  <button
                    type="button"
                    className="text-xs font-medium py-1 px-1 -mr-1 rounded transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
                      text-primary-600 hover:text-primary-700 active:text-primary-800"
                    onClick={() => {
                      setError("");
                      setInfo("Please contact your administrator to reset your password.");
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Lock size={18} className="text-skin-muted" aria-hidden="true" />
                  </div>
                  <input
                    ref={passwordRef}
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    maxLength={256}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
                    placeholder="Enter your password"
                    aria-invalid={!!error && error.toLowerCase().includes("password")}
                    aria-describedby={error ? "login-error" : undefined}
                    className="w-full pl-10 pr-12 py-2.5 border border-skin rounded-xl text-base outline-none transition-colors
                      focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500
                      bg-surface-alt text-skin-base placeholder:text-skin-muted"
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex items-center justify-center w-11 text-skin-muted hover:text-skin-base
                      transition-colors rounded-r-xl
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff size={18} aria-hidden="true" />
                    ) : (
                      <Eye size={18} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember me */}
              <div className="flex items-center py-1">
                <input
                  id="login-remember"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-5 w-5 rounded border-skin text-primary-600 focus:ring-primary-500 cursor-pointer"
                />
                <label htmlFor="login-remember" className="ml-2.5 text-sm cursor-pointer select-none py-1 text-skin-muted">
                  Remember my username
                </label>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary btn-primary--full"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          </div>

          {/* Help text */}
          <p className="text-center text-xs text-skin-muted">
            Having trouble signing in? Contact your system administrator.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 flex flex-col items-center gap-3 text-xs text-skin-muted">
        <ThemeSelector variant="pill" />
        <div>
          <span>Powered by ADS Softek</span>
          <span className="mx-2" aria-hidden="true">&middot;</span>
          <span>&copy; {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
