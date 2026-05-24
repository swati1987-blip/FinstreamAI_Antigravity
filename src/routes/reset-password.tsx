import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Sparkles, ShieldCheck, Check, ArrowRight, Eye, EyeOff, XCircle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({ meta: [{ title: "Restore Security Key — FinStream AI" }] }),
});

interface BarData {
  id: number;
  height: number;
  label: string;
  metric: string;
  growth: string;
  x: number;
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Dynamic Password Validation Rules
  const hasEightChars = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const isPasswordValid = hasEightChars && hasNumber && hasSpecialChar && passwordsMatch;

  // Detect recovery params in URL to identify active recovery attempts
  const [hasRecoveryParams, setHasRecoveryParams] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const search = window.location.search || "";
      const hasParams = 
        hash.includes("access_token") || 
        search.includes("token") || 
        hash.includes("type=recovery") ||
        hash.includes("error=");
      setHasRecoveryParams(hasParams);
    }
  }, []);

  // SVG Hover Interactive State
  const [hoveredBar, setHoveredBar] = useState<BarData | null>(null);

  const bars: BarData[] = [
    { id: 0, height: 110, label: "KS subsidiary", metric: "$48,250.00", growth: "+14.8%", x: 95 },
    { id: 1, height: 75, label: "TI subsidiary", metric: "$31,400.00", growth: "+8.2%", x: 165 },
    { id: 2, height: 140, label: "CPM subsidiary", metric: "$62,910.00", growth: "+21.4%", x: 235 },
    { id: 3, height: 95, label: "AAS subsidiary", metric: "$39,800.00", growth: "+11.3%", x: 305 },
    { id: 4, height: 50, label: "Personal Wealth", metric: "$18,120.00", growth: "-2.4%", x: 375 },
  ];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      toast.error("Please satisfy all password complexity and matching rules.");
      return;
    }
    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setSuccess(true);
    toast.success("Security credentials updated successfully!");
    
    // Smooth transition into dashboard after success
    setTimeout(() => {
      navigate({ to: "/dashboard" });
    }, 2500);
  };

  // Render a beautiful, full-page premium loader if state is loading
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B132B] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#D4AF37]" />
        <span className="text-xs text-gray-400 font-medium tracking-widest uppercase">Initializing Vault Connection...</span>
      </div>
    );
  }

  // Render warning block if user is not authenticated and no recovery parameters are present
  const isSessionInvalid = !user && !hasRecoveryParams;

  return (
    <div className="min-h-screen bg-[#0B132B] text-white flex flex-col justify-between selection:bg-[#D4AF37] selection:text-[#0B132B] relative overflow-hidden">
      {/* Decorative Gold Ambient Glows */}
      <div className="absolute top-[-10%] left-[-15%] w-[60%] h-[60%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      {/* Main Premium Portal Layout Grid */}
      <main className="flex-1 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 px-6 py-12 lg:py-20 relative z-10 items-center">
        
        {/* Left Side: Brand Story & Interactive SVG Chart Widget */}
        <div className="lg:col-span-7 flex flex-col justify-center space-y-8 lg:pr-8">
          
          {/* Elite branding label */}
          <div className="inline-flex items-center gap-2 self-start px-3.5 py-1.5 rounded-full border border-[#D4AF37]/20 bg-[#0B132B]/80 text-xs font-semibold text-[#D4AF37] shadow-lg">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span>FinStream AI — Elite Statement Automation</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight text-white">
              Restore Portal Access{" "}
              <span className="bg-gradient-to-r from-[#FFF] via-[#D4AF37] to-[#C59B27] bg-clip-text text-transparent">
                Securely
              </span>
            </h1>
            <p className="text-sm sm:text-base text-gray-300 font-light leading-relaxed max-w-xl">
              Restore access to your private key vault. Update your security password to reconnect with automated corporate subsidiary ledgers.
            </p>
          </div>

          {/* Dynamic Interactive SVG Financial Centerpiece */}
          <div className="relative w-full max-w-lg bg-[#141C34]/80 rounded-2xl border border-[#D4AF37]/15 p-6 shadow-2xl backdrop-blur-md overflow-hidden group">
            
            {/* SVG Header Card */}
            <div className="flex items-center justify-between border-b border-gray-800 pb-3.5 mb-5">
              <span className="text-[10px] uppercase tracking-widest text-[#D4AF37] font-bold flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#D4AF37] animate-ping" />
                Ledger Visual Analytics Engine
              </span>
              <span className="text-[10px] text-gray-400 font-medium font-mono">live_simulation_feed</span>
            </div>

            {/* Interactive SVG widget */}
            <div className="relative flex justify-center">
              <svg 
                viewBox="0 0 500 240" 
                className="w-full h-auto text-gray-500 overflow-visible transition-all duration-300"
              >
                <line x1="50" y1="50" x2="450" y2="50" stroke="#1D2845" strokeDasharray="3,3" />
                <line x1="50" y1="110" x2="450" y2="110" stroke="#1D2845" strokeDasharray="3,3" />
                <line x1="50" y1="170" x2="450" y2="170" stroke="#1D2845" strokeDasharray="3,3" />
                <line x1="50" y1="210" x2="450" y2="210" stroke="#1D2845" strokeWidth="1.5" />

                <text x="35" y="54" className="text-[9px] fill-gray-500 font-mono">100k</text>
                <text x="35" y="114" className="text-[9px] fill-gray-500 font-mono">50k</text>
                <text x="35" y="174" className="text-[9px] fill-gray-500 font-mono">10k</text>
                <text x="35" y="214" className="text-[9px] fill-gray-500 font-mono">0</text>

                <path 
                  d="M 95 190 Q 165 110 235 150 T 375 70 T 420 60" 
                  fill="none" 
                  stroke="url(#goldGradientLineReset)" 
                  strokeWidth="2.5" 
                  className="opacity-75"
                />
                
                <defs>
                  <linearGradient id="goldGradientLineReset" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#C59B27" />
                    <stop offset="50%" stopColor="#D4AF37" />
                    <stop offset="100%" stopColor="#FFF2AF" />
                  </linearGradient>
                  
                  <linearGradient id="barGradientReset" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#D4AF37" stopOpacity="0.85" />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity="0.2" />
                  </linearGradient>

                  <linearGradient id="barGradientHoverReset" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#FFF2AF" />
                    <stop offset="50%" stopColor="#D4AF37" />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity="0.4" />
                  </linearGradient>
                </defs>

                {bars.map((bar) => {
                  const isHovered = hoveredBar?.id === bar.id;
                  return (
                    <g 
                      key={bar.id} 
                      className="cursor-pointer group/bar"
                      onMouseEnter={() => setHoveredBar(bar)}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <rect 
                        x={bar.x - 12} 
                        y="30" 
                        width="34" 
                        height="180" 
                        fill="transparent" 
                      />
                      <rect
                        x={bar.x - 5}
                        y={210 - bar.height}
                        width="20"
                        height={bar.height}
                        rx="3"
                        fill="#D4AF37"
                        className={`transition-all duration-300 ${isHovered ? "opacity-30 blur-sm scale-y-[1.03]" : "opacity-0"}`}
                        style={{ transformOrigin: `center 210px` }}
                      />
                      <rect
                        x={bar.x - 5}
                        y={210 - bar.height}
                        width="20"
                        height={bar.height}
                        rx="3"
                        fill={isHovered ? "url(#barGradientHoverReset)" : "url(#barGradientReset)"}
                        stroke={isHovered ? "#FFF2AF" : "#D4AF37"}
                        strokeWidth={isHovered ? "1.5" : "0.5"}
                        className="transition-all duration-300 ease-out"
                        style={{ transformOrigin: `center 210px`, transform: isHovered ? "scaleY(1.02)" : "scaleY(1)" }}
                      />
                      <text 
                        x={bar.x + 5} 
                        y="228" 
                        textAnchor="middle" 
                        className={`text-[8px] font-mono transition-all duration-200 ${isHovered ? "fill-[#D4AF37] font-semibold" : "fill-gray-400"}`}
                      >
                        {bar.label.split(" ")[0]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className={`absolute bottom-4 left-6 right-6 bg-[#0B132B]/95 border border-[#D4AF37]/35 rounded-xl px-4 py-3 shadow-2xl flex items-center justify-between gap-4 transition-all duration-300 transform ${hoveredBar ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"}`}>
              {hoveredBar && (
                <>
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Entity Selected</span>
                    <span className="text-xs text-white font-bold">{hoveredBar.label}</span>
                  </div>
                  <div className="h-6 w-px bg-gray-800" />
                  <div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">Asset Metric</span>
                    <span className="text-xs text-[#D4AF37] font-extrabold">{hoveredBar.metric}</span>
                  </div>
                  <div className="h-6 w-px bg-gray-800" />
                  <div className="text-right">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider block font-semibold">MoM Growth</span>
                    <span className={`text-xs font-extrabold ${hoveredBar.growth.startsWith("+") ? "text-emerald-400" : "text-rose-400"}`}>
                      {hoveredBar.growth}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className={`absolute bottom-4 left-6 right-6 text-center text-[10px] text-gray-400 tracking-wide font-light py-1.5 transition-all duration-300 pointer-events-none ${hoveredBar ? "opacity-0" : "opacity-100"}`}>
              💡 Hover cursor over bar fragments to test dynamic metric simulations
            </div>
          </div>

        </div>

        {/* Right Side: Fluid Password Reset Form or Invalid Session Alert */}
        <div className="lg:col-span-5 flex justify-center w-full">
          <div className="w-full max-w-md bg-[#141C34] border border-[#D4AF37]/25 rounded-2xl p-6 sm:p-8 shadow-2xl relative backdrop-blur-md">
            
            {/* Header branding logo inside card */}
            <div className="flex items-center gap-2 justify-center mb-6 border-b border-gray-800 pb-5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#C59B27] to-[#FFF2AF] flex items-center justify-center shadow-md">
                <Sparkles className="w-4.5 h-4.5 text-[#0B132B]" />
              </div>
              <span className="text-base font-bold tracking-tight bg-gradient-to-r from-[#FFF] to-[#D4AF37] bg-clip-text text-transparent">
                FinStream AI
              </span>
            </div>

            {isSessionInvalid ? (
              // Invalid Session Warning Panel
              <div className="space-y-6 text-center py-4 animate-fade-in">
                <div className="mx-auto w-14 h-14 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-2">
                  <ShieldAlert className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-bold text-white tracking-tight">Invalid Recovery Session</h2>
                  <p className="text-xs text-gray-400 leading-relaxed px-2">
                    Your password recovery checkpoint requires a valid session token. This session could have expired, or was accessed without a verified email recovery link.
                  </p>
                </div>
                <Button 
                  onClick={() => navigate({ to: "/login" })}
                  className="w-full bg-[#D4AF37] hover:bg-[#C59B27] text-[#0B132B] font-bold h-10 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                >
                  <span>Return to Authentication Hub</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            ) : success ? (
              // Success Confirmation State
              <div className="space-y-6 text-center py-6 animate-fade-in">
                <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-400/40 flex items-center justify-center text-emerald-400 mb-2 shadow-[0_0_20px_rgba(16,185,129,0.2)] animate-pulse">
                  <Check className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-extrabold text-white tracking-tight">Credentials Restored</h2>
                  <p className="text-xs text-gray-300 leading-relaxed px-4">
                    Your security credentials have been updated. Preparing secure environment tunnels and loading automated corporate statement streams...
                  </p>
                </div>
                <div className="flex justify-center items-center gap-2 text-xs text-[#D4AF37] font-mono animate-pulse pt-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Configuring workspace...</span>
                </div>
              </div>
            ) : (
              // Standard Password Update View
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-bold tracking-tight text-white">Reset Security Password</h2>
                  <p className="text-[12px] text-gray-400 mt-1">
                    Establish a new high-security password for your multi-entity bookkeeping vault.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  
                  {/* Password Input */}
                  <div className="space-y-1.5">
                    <Label htmlFor="passwordReset" className="text-xs text-gray-300 font-medium">New Security Password</Label>
                    <div className="relative">
                      <Input
                        id="passwordReset"
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-[#0B132B]/80 border-gray-700 focus:border-[#D4AF37] focus:ring-0 text-white placeholder-gray-500 rounded-lg text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPasswordReset" className="text-xs text-gray-300 font-medium">Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        id="confirmPasswordReset"
                        type={showPassword ? "text" : "password"}
                        required
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="bg-[#0B132B]/80 border-gray-700 focus:border-[#D4AF37] focus:ring-0 text-white placeholder-gray-500 rounded-lg text-sm pr-10"
                      />
                    </div>
                  </div>

                  {/* Real-time Dynamic Security Rules Checklist */}
                  <div className="mt-3 p-3 rounded-lg bg-[#0B132B]/60 border border-gray-800 space-y-1.5 transition-all duration-300">
                    <span className="text-[10px] font-semibold text-[#D4AF37]/80 uppercase tracking-wider block">
                      Ledger Security Checklist
                    </span>
                    <ul className="space-y-1 text-[11px]">
                      <li className={`flex items-center gap-2 transition-all ${hasEightChars ? "text-emerald-400 font-medium" : "text-gray-500"}`}>
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center border text-[8px] transition-all ${hasEightChars ? "bg-emerald-500/10 border-emerald-400 text-emerald-400 scale-105" : "border-gray-700 text-transparent"}`}>
                          ✓
                        </span>
                        <span>8+ characters</span>
                      </li>
                      <li className={`flex items-center gap-2 transition-all ${hasNumber ? "text-emerald-400 font-medium" : "text-gray-500"}`}>
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center border text-[8px] transition-all ${hasNumber ? "bg-emerald-500/10 border-emerald-400 text-emerald-400 scale-105" : "border-gray-700 text-transparent"}`}>
                          ✓
                        </span>
                        <span>At least 1 number</span>
                      </li>
                      <li className={`flex items-center gap-2 transition-all ${hasSpecialChar ? "text-emerald-400 font-medium" : "text-gray-500"}`}>
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center border text-[8px] transition-all ${hasSpecialChar ? "bg-emerald-500/10 border-emerald-400 text-emerald-400 scale-105" : "border-gray-700 text-transparent"}`}>
                          ✓
                        </span>
                        <span>At least 1 special character</span>
                      </li>
                      <li className={`flex items-center gap-2 transition-all ${passwordsMatch ? "text-emerald-400 font-medium" : "text-gray-500"}`}>
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center border text-[8px] transition-all ${passwordsMatch ? "bg-emerald-500/10 border-emerald-400 text-emerald-400 scale-105" : "border-gray-700 text-transparent"}`}>
                          ✓
                        </span>
                        <span>Passwords match precisely</span>
                      </li>
                    </ul>
                  </div>

                  {/* Submit Button */}
                  <Button 
                    type="submit" 
                    className="w-full bg-[#D4AF37] hover:bg-[#C59B27] text-[#0B132B] hover:brightness-110 font-bold transition-all shadow-[0_4px_20px_rgba(212,175,55,0.25)] h-10 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer mt-2" 
                    disabled={submitting || !isPasswordValid}
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#0B132B]" />
                    ) : (
                      <>
                        <span>Verify and Apply Recovery Key</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>

                </form>

                <p className="text-xs text-center mt-6">
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/login" })}
                    className="text-[#D4AF37] hover:text-[#FFF] font-bold transition-colors cursor-pointer focus:outline-none underline"
                  >
                    Return to login page
                  </button>
                </p>
              </>
            )}

          </div>
        </div>

      </main>

      {/* Premium visual footer aligned with theme */}
      <footer className="border-t border-gray-800/80 py-5 text-center text-[11px] text-gray-500 relative z-10 bg-[#0B132B]/80 backdrop-blur-sm">
        <p>&copy; {new Date().getFullYear()} FinStream AI. Managed wealth, statements and dual authorization ledger flow. Secure TLS Pipelines.</p>
      </footer>
      <Toaster />
    </div>
  );
}
