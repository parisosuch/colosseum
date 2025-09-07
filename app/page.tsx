import { ArrowRight, LandmarkIcon } from "lucide-react";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      <div className="flex flex-row items-center text-4xl font-semibold space-x-2">
        <LandmarkIcon size={48} />
        <h1>Welcome to Colosseum.</h1>
      </div>
      <p>Account creation is currently invite only.</p>
      <Link href='/auth/login' className="flex flex-row items-center justify-center mt-4 space-x-1">
        <p className="underline">Login</p>
        <ArrowRight size={16} />
      </Link>
    </main >
  );
}
