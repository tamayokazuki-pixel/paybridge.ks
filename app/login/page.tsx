import { AuthCard } from "@/components/AuthCard";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <AuthCard
      eyebrow="Secure access"
      title="Sign in"
      subtitle="Don't have an account?"
      switchHref="/register"
      switchLabel="Create one"
    >
      <LoginForm />
    </AuthCard>
  );
}
