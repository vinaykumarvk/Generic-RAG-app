import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiPost } from "@/lib/api";
import { UserPlus, Copy, Check, X } from "lucide-react";

interface CreateUserFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let pwd = "";
  const arr = new Uint32Array(16);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 16; i++) {
    pwd += chars[arr[i] % chars.length];
  }
  return pwd;
}

export function CreateUserForm({ onSuccess, onCancel }: CreateUserFormProps) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [userType, setUserType] = useState<"USER" | "ADMIN">("USER");
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: { email: string; full_name: string; password: string; user_type: string }) =>
      apiPost("/api/v1/users", data),
    onSuccess: () => {
      // Don't close yet — show the generated password
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const password = generatePassword();
    setGeneratedPassword(password);
    createMutation.mutate({ email, full_name: fullName, password, user_type: userType });
  };

  const handleCopy = async () => {
    if (generatedPassword) {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (createMutation.isSuccess && generatedPassword) {
    return (
      <div className="bg-surface-primary border border-border-primary rounded-xl p-6 space-y-4">
        <h4 className="text-sm font-semibold text-text-primary">User created successfully</h4>
        <p className="text-sm text-text-secondary">
          Share this temporary password with the user. They should change it on first login.
        </p>
        <div className="flex items-center gap-2 bg-surface-secondary rounded-lg p-3">
          <code className="flex-1 text-sm font-mono text-text-primary">{generatedPassword}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-surface-primary text-text-tertiary hover:text-text-primary transition-colors"
            aria-label="Copy password"
          >
            {copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
        </div>
        <button
          type="button"
          onClick={onSuccess}
          className="btn-primary"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface-primary border border-border-primary rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          <UserPlus size={16} aria-hidden="true" />
          Create New User
        </h4>
        <button type="button" onClick={onCancel} className="text-text-tertiary hover:text-text-primary" aria-label="Close form">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="create-fullname" className="block text-xs font-medium text-text-secondary mb-1">Full Name</label>
          <input
            id="create-fullname"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
          />
        </div>
        <div>
          <label htmlFor="create-email" className="block text-xs font-medium text-text-secondary mb-1">Email</label>
          <input
            id="create-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
          />
        </div>
      </div>
      <div>
        <label htmlFor="create-role" className="block text-xs font-medium text-text-secondary mb-1">Role</label>
        <select
          id="create-role"
          value={userType}
          onChange={(e) => setUserType(e.target.value as "USER" | "ADMIN")}
          className="w-full px-3 py-2 text-sm border border-border-primary rounded-lg bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
        >
          <option value="USER">User</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      {createMutation.error && (
        <p className="text-sm text-danger">{createMutation.error.message}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={createMutation.isPending || !email || !fullName}
          className="btn-primary"
        >
          {createMutation.isPending ? "Creating..." : "Create User"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm border border-border-primary rounded-lg text-text-secondary hover:bg-surface-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
