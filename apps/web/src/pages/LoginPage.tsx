import { useState, useEffect, useRef, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { ThemeSelector } from "@/components/ThemeSelector";
import {
  Eye, EyeOff, Loader2, AlertCircle, Info,
  User, Lock, Search, Shield, Brain, Quote, Sun, Moon,
} from "lucide-react";

const QUOTATIONS = [
  {
    text: "Knowledge is power. Information is liberating. Education is the premise of progress.",
    author: "Kofi Annan",
  },
  {
    text: "The goal is to turn data into information, and information into insight.",
    author: "Carly Fiorina",
  },
  {
    text: "In God we trust. All others must bring data.",
    author: "W. Edwards Deming",
  },
  {
    text: "Intelligence is the ability to adapt to change. Technology is the enabler.",
    author: "Stephen Hawking",
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const { isDark, setTheme, theme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem("intellirag_remember") === "true");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentQuote, setCurrentQuote] = useState(0);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Restore remembered username + autofocus
  useEffect(() => {
    if (localStorage.getItem("intellirag_remember") === "true") {
      const saved = localStorage.getItem("intellirag_remembered_user");
      if (saved) setUsername(saved);
    }
    usernameRef.current?.focus();
  }, []);

  // Rotating quotes
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentQuote((prev) => (prev + 1) % QUOTATIONS.length);
    }, 5000);
    return () => clearInterval(interval);
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

  const toggleThemeMode = () => {
    // Simple light/dark toggle — picks "default" for light, "tokyo-night" for dark
    if (isDark) {
      setTheme("default");
    } else {
      setTheme("tokyo-night");
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row overflow-hidden bg-skin-base">
      {/* Screen reader live region */}
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {error}
      </div>

      {/* ──── Left Hero Panel ──── */}
      <div className="h-[55dvh] lg:h-auto lg:w-1/2 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, rgb(var(--color-primary-800)), rgb(var(--color-primary-600)), rgb(var(--color-primary-500)))" }}
      >
        {/* Decorative blur orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full blur-3xl"
            style={{ background: "rgba(var(--color-primary-400), 0.3)" }} />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full blur-3xl"
            style={{ background: "rgba(var(--color-primary-400), 0.3)" }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl"
            style={{ background: "rgba(var(--color-primary-300), 0.15)" }} />
        </div>

        {/* Hero content */}
        <div className="relative z-10 flex flex-col justify-center h-full px-4 sm:px-6 lg:px-12 xl:px-16 py-8">
          {/* Logo + branding */}
          <div className="mb-2 sm:mb-3 lg:mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-xl flex items-center justify-center bg-white/15 backdrop-blur-sm">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="text-white">
                  <path d="M16 2L4 8v8c0 7.73 5.12 14.96 12 16 6.88-1.04 12-8.27 12-16V8L16 2z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="16" cy="14" r="5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  <path d="M13.5 14c0-1.38 1.12-2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  <path d="M16 19v3M12 22h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-white text-lg sm:text-xl lg:text-xl font-bold leading-tight">
                  ADS Knowledge Agent
                </span>
                <span className="text-white/70 text-xs sm:text-sm font-medium">
                  Intelligent Document Search &amp; Analysis
                </span>
              </div>
            </div>
          </div>

          {/* Welcome message */}
          <div className="mb-3 sm:mb-4 lg:mb-6">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl xl:text-5xl font-bold text-white mb-1 sm:mb-2 leading-tight">
              Welcome to<br />
              <span className="text-white/90">ADS Knowledge Agent</span>
            </h1>
            <p className="text-sm sm:text-base text-white/70 leading-relaxed">
              Search, analyze, and extract insights from your document repository with AI-powered intelligence.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-3 sm:mb-4 lg:mb-6">
            <div className="flex flex-col items-center p-3 sm:p-4 lg:p-6 rounded-xl bg-white/10 border border-white/10 backdrop-blur-sm">
              <div className="p-2.5 sm:p-3 lg:p-4 rounded-full bg-white/10 mb-2 sm:mb-2.5 lg:mb-3">
                <Search className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" aria-hidden="true" />
              </div>
              <p className="text-xs sm:text-sm font-medium text-center text-white">Search</p>
            </div>
            <div className="flex flex-col items-center p-3 sm:p-4 lg:p-6 rounded-xl bg-white/10 border border-white/10 backdrop-blur-sm">
              <div className="p-2.5 sm:p-3 lg:p-4 rounded-full bg-white/10 mb-2 sm:mb-2.5 lg:mb-3">
                <Shield className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" aria-hidden="true" />
              </div>
              <p className="text-xs sm:text-sm font-medium text-center text-white">Security</p>
            </div>
            <div className="flex flex-col items-center p-3 sm:p-4 lg:p-6 rounded-xl bg-white/10 border border-white/10 backdrop-blur-sm">
              <div className="p-2.5 sm:p-3 lg:p-4 rounded-full bg-white/10 mb-2 sm:mb-2.5 lg:mb-3">
                <Brain className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" aria-hidden="true" />
              </div>
              <p className="text-xs sm:text-sm font-medium text-center text-white">Intelligence</p>
            </div>
          </div>

          {/* Rotating quotes */}
          <div className="relative min-h-[70px] sm:min-h-[80px] lg:min-h-[100px]">
            {QUOTATIONS.map((quote, index) => (
              <div
                key={index}
                className={`absolute inset-0 transition-all duration-500 ${
                  index === currentQuote
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4 pointer-events-none"
                }`}
              >
                <div className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white/10 border border-white/10 backdrop-blur-sm">
                  <Quote className="h-5 w-5 sm:h-6 sm:w-6 text-white/70 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1">
                    <p className="text-sm sm:text-base lg:text-sm text-white italic mb-2 leading-relaxed">
                      &ldquo;{quote.text}&rdquo;
                    </p>
                    <p className="text-xs sm:text-sm lg:text-xs text-white/60 font-medium">
                      &mdash; {quote.author}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ──── Right Form Panel ──── */}
      <div className="h-[45dvh] lg:flex-1 lg:h-auto flex items-start lg:items-center justify-center p-1 sm:p-2 lg:p-8 bg-skin-base overflow-y-auto -mt-2 sm:-mt-3 lg:mt-0">
        <div className="w-full max-w-md mt-0 lg:mt-0">
          <div className="rounded-2xl shadow-lg lg:shadow-xl p-4 sm:p-6 lg:p-8 bg-surface border border-skin">
            {/* Header */}
            <div className="text-center mb-4 sm:mb-6">
              <h2 className="text-lg sm:text-xl lg:text-3xl font-bold text-skin-base mb-0.5 sm:mb-1">Sign In</h2>
              <p className="text-[10px] sm:text-xs lg:text-base text-skin-muted">
                Access your knowledge workspace
              </p>
            </div>

            {/* Info banner */}
            {info && (
              <div
                role="status"
                className="mb-4 sm:mb-6 flex items-start gap-3 text-sm px-4 py-3 rounded-xl bg-primary-50 border border-primary-200 text-primary-700"
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
                className="mb-4 sm:mb-6 flex items-start gap-3 text-sm px-4 py-3 rounded-xl border bg-[rgb(var(--color-danger-soft))] border-[rgb(var(--color-danger-border))] text-[rgb(var(--color-danger))]"
              >
                <AlertCircle size={18} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4" noValidate>
              {/* Username */}
              <div className="space-y-1.5">
                <label htmlFor="login-username" className="block text-xs sm:text-sm font-semibold text-skin-base">
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
                    className="w-full h-9 sm:h-10 lg:h-11 pl-10 pr-3 border border-skin rounded-xl text-sm outline-none transition-colors
                      focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:border-primary-500
                      bg-surface-alt text-skin-base placeholder:text-skin-muted"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="block text-xs sm:text-sm font-semibold text-skin-base">
                  Password
                </label>
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
                    className="w-full h-9 sm:h-10 lg:h-11 pl-10 pr-12 border border-skin rounded-xl text-sm outline-none transition-colors
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

              {/* Remember me + Forgot password */}
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <input
                    id="login-remember"
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-skin text-primary-600 focus:ring-primary-500 cursor-pointer"
                  />
                  <label htmlFor="login-remember" className="text-xs sm:text-sm cursor-pointer select-none text-skin-muted">
                    Remember username
                  </label>
                </div>
                <button
                  type="button"
                  className="text-xs sm:text-sm font-medium py-1 px-1 rounded transition-colors
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

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="btn-primary btn-primary--full mt-2"
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
        </div>
      </div>

      {/* ──── Fixed Footer ──── */}
      <div className="fixed bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 text-xs text-skin-muted bg-surface/80 backdrop-blur-sm border-t border-skin z-20">
        <div className="flex items-center gap-3">
          <span>&copy; {new Date().getFullYear()} ADS Softek</span>
          <ThemeSelector variant="compact" />
        </div>
        <button
          type="button"
          onClick={toggleThemeMode}
          className="p-2 rounded-lg transition-colors hover:bg-surface-alt
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
