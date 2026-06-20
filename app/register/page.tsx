import { AuthCard } from "@/components/AuthCard";
import { RegisterForm } from "@/components/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthCard
      eyebrow="Open an account"
      title="Create account"
      subtitle="Already registered?"
      switchHref="/login"
      switchLabel="Sign in"
    >
      <RegisterForm />
    </AuthCard>
  );
}
