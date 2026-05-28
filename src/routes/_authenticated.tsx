import { createFileRoute, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  // Persist and restore scroll positions across route transitions
  useEffect(() => {
    if (loading || !user) return;
    
    const path = location.pathname;
    const savedScroll = sessionStorage.getItem(`scroll_${path}`);
    
    // We delay the scrolling slightly to let the page contents render/layout settle
    const timer = setTimeout(() => {
      if (savedScroll) {
        window.scrollTo({
          top: parseInt(savedScroll, 10),
          behavior: "instant"
        });
      } else {
        window.scrollTo(0, 0);
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [location.pathname, loading, user]);

  useEffect(() => {
    if (loading || !user) return;

    const handleScroll = () => {
      sessionStorage.setItem(`scroll_${location.pathname}`, window.scrollY.toString());
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [location.pathname, loading, user]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <Outlet />;
}
