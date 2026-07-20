import { demoLoginEnabled } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return <LoginForm demoEnabled={demoLoginEnabled()} />;
}
