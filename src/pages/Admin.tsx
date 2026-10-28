import { useMemo, useState, type FormEvent } from "react";
import {
  Check,
  KeyRound,
  Layers,
  ShieldCheck,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  modules,
  users as seedUsers,
  type ModuleKey,
  type User,
  type UserStatus,
} from "@/data/mockData";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const moduleShortLabel: Record<ModuleKey, string> = {
  ipo: "IPO",
  portfolio: "Portfolio",
  sip: "SIP",
};

type FormErrors = Partial<
  Record<"name" | "email" | "password" | "permissions", string>
>;

const statusStyles: Record<UserStatus, { dot: string; text: string }> = {
  active: { dot: "bg-signal", text: "text-signal" },
  invited: { dot: "bg-gold", text: "text-gold" },
  suspended: { dot: "bg-negative", text: "text-negative" },
};

function PermissionChips({ permissions }: { permissions: ModuleKey[] }) {
  if (permissions.length === 0) {
    return <span className="text-[10px] text-muted-foreground/60">No access</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {permissions.map((permission) => (
        <span
          key={permission}
          className="rounded border border-white/[0.09] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-muted-foreground"
        >
          {moduleShortLabel[permission]}
        </span>
      ))}
    </div>
  );
}

export default function Admin() {
  const [users, setUsers] = useState<User[]>(seedUsers);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<ModuleKey[]>(["ipo"]);
  const [errors, setErrors] = useState<FormErrors>({});

  const stats = useMemo(() => {
    const admins = users.filter((user) => user.role === "admin").length;
    const active = users.filter((user) => user.status === "active").length;
    const grants = users.reduce(
      (total, user) => total + user.permissions.length,
      0,
    );
    return { total: users.length, admins, active, grants };
  }, [users]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setSelected(["ipo"]);
    setErrors({});
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) resetForm();
  };

  const toggleModule = (key: ModuleKey) => {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
    setErrors((current) => ({ ...current, permissions: undefined }));
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: FormErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedName.length < 2) {
      nextErrors.name = "Enter the teammate's full name.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    } else if (
      users.some((user) => user.email.toLowerCase() === trimmedEmail)
    ) {
      nextErrors.email = "That email already has access.";
    }
    if (password.length < 6) {
      nextErrors.password = "Use at least 6 characters.";
    }
    if (selected.length === 0) {
      nextErrors.permissions = "Assign at least one module.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const today = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date());

    const nextUser: User = {
      id: users.reduce((max, user) => Math.max(max, user.id), 0) + 1,
      name: trimmedName,
      email: trimmedEmail,
      role: "user",
      permissions: selected,
      status: "invited",
      joinedOn: today,
      lastActive: "Invite pending",
    };

    setUsers((current) => [nextUser, ...current]);
    toast.success(`${nextUser.name} added to the workspace`, {
      description: `Module access: ${selected
        .map((item) => moduleShortLabel[item])
        .join(", ")}. Invitation email is simulated in Phase 1.`,
    });
    handleOpenChange(false);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin panel"
        description="Approve who gets into StockPilot, then decide which modules they can open. Permissions govern both the sidebar and the routes behind it."
        actions={
          <Button
            onClick={() => setOpen(true)}
            size="sm"
            className="h-9 gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground shadow-[0_14px_30px_-14px_oklch(0.836_0.137_84/0.8),inset_0_1px_0_rgba(255,255,255,0.3)] hover:bg-primary/90"
          >
            <UserPlus className="size-3.5" />
            Create user
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Total users",
            value: String(stats.total),
            note: "approved accounts",
            icon: UsersIcon,
          },
          {
            label: "Administrators",
            value: String(stats.admins),
            note: "full workspace access",
            icon: ShieldCheck,
          },
          {
            label: "Active",
            value: String(stats.active),
            note: "active this month",
            icon: KeyRound,
          },
          {
            label: "Module grants",
            value: String(stats.grants),
            note: "across all users",
            icon: Layers,
          },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="glass lift rounded-2xl p-4"
            >
              <div className="flex items-start justify-between">
                <p className="text-[9px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                  {stat.label}
                </p>
                <Icon className="size-3.5 text-primary/70" />
              </div>
              <p className="num mt-2.5 text-xl font-medium">{stat.value}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {stat.note}
              </p>
            </div>
          );
        })}
      </section>

      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-2 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Workspace users</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Admin access is role-based; modules are granted per user.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-muted-foreground">
            <ShieldCheck className="size-3 text-primary" />
            Allowlist enforced
          </span>
        </div>

        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {["User", "Role", "Modules", "Status", "Last active"].map(
                  (heading) => (
                    <th
                      key={heading}
                      className={cn(
                        "px-4 py-2.5 text-left text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase",
                        heading === "Last active" && "text-right",
                        heading === "User" && "pl-5",
                      )}
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const status = statusStyles[user.status];
                return (
                  <tr
                    key={user.id}
                    className="border-b border-white/[0.05] transition-colors last:border-0 hover:bg-white/[0.03]"
                  >
                    <td className="py-3 pl-5">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 place-items-center rounded-full border border-white/[0.09] bg-white/[0.04] font-display text-[10px] font-semibold text-muted-foreground">
                          {initials(user.name)}
                        </span>
                        <div>
                          <p className="text-[12px] font-medium text-foreground">
                            {user.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4">
                      <span
                        className={cn(
                          "inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] uppercase",
                          user.role === "admin"
                            ? "border-primary/25 bg-primary/10 text-primary"
                            : "border-white/[0.09] bg-white/[0.04] text-muted-foreground",
                        )}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <PermissionChips permissions={user.permissions} />
                    </td>
                    <td className="px-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-[10px] capitalize",
                          status.text,
                        )}
                      >
                        <span
                          className={cn("size-1.5 rounded-full", status.dot)}
                        />
                        {user.status}
                      </span>
                    </td>
                    <td className="num px-4 py-3 text-right text-[10px] text-muted-foreground">
                      {user.lastActive}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-white/[0.05] md:hidden">
          {users.map((user) => {
            const status = statusStyles[user.status];
            return (
              <div key={user.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/[0.09] bg-white/[0.04] font-display text-[10px] font-semibold text-muted-foreground">
                      {initials(user.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">
                        {user.name}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] uppercase",
                      user.role === "admin"
                        ? "border-primary/25 bg-primary/10 text-primary"
                        : "border-white/[0.09] bg-white/[0.04] text-muted-foreground",
                    )}
                  >
                    {user.role}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <PermissionChips permissions={user.permissions} />
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[10px] capitalize",
                      status.text,
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", status.dot)} />
                    {user.status}
                  </span>
                </div>
                <p className="num mt-2 text-[9px] text-muted-foreground/70">
                  Last active · {user.lastActive}
                </p>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-3 text-[9px] text-muted-foreground/70 sm:px-5">
          Phase 1 preview. New users are held in local state only; Supabase
          authentication, password hashing and invitation emails arrive with the
          backend.
        </div>
      </section>

      <section className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md border border-primary/20 bg-primary/10">
            <ShieldCheck className="size-3 text-primary" />
          </span>
          <h2 className="text-sm font-semibold">Access model</h2>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <p className="text-[11px] font-medium text-foreground">
              Role → workspace
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Administrators unlock the Admin Panel and every module. Standard
              users only see what they have been granted.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <p className="text-[11px] font-medium text-foreground">
              Modules → routes
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              IPO, Portfolio and SIP each gate both the sidebar link and the
              route, so a hidden module cannot be opened by URL.
            </p>
          </div>
        </div>
      </section>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="glass-deep gap-0 overflow-hidden border-white/10 p-0 sm:max-w-md">
          <form onSubmit={handleCreate}>
            <DialogHeader className="border-b border-white/[0.07] px-5 py-4 text-left">
              <DialogTitle className="flex items-center gap-2 font-display text-base">
                <UserPlus className="size-4 text-primary" />
                Create user
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px] leading-relaxed">
                Add a teammate to the allowlist, then choose the modules they can
                open.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-3.5 overflow-y-auto px-5 py-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="new-name"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Name
                </label>
                <Input
                  id="new-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setErrors((current) => ({ ...current, name: undefined }));
                  }}
                  placeholder="Ananya Deshpande"
                  autoComplete="off"
                  className="h-10 border-white/10 bg-black/30 text-[12px]"
                />
                {errors.name ? (
                  <p className="text-[10px] text-negative">{errors.name}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="new-email"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Email
                </label>
                <Input
                  id="new-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setErrors((current) => ({ ...current, email: undefined }));
                  }}
                  placeholder="ananya@stockpilot.io"
                  autoComplete="off"
                  className="h-10 border-white/10 bg-black/30 text-[12px]"
                />
                {errors.email ? (
                  <p className="text-[10px] text-negative">{errors.email}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="new-password"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Password
                </label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setErrors((current) => ({
                      ...current,
                      password: undefined,
                    }));
                  }}
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                  className="h-10 border-white/10 bg-black/30 text-[12px]"
                />
                {errors.password ? (
                  <p className="text-[10px] text-negative">{errors.password}</p>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Module access
                </p>
                <div className="mt-2 space-y-2">
                  {modules.map((module) => {
                    const checked = selected.includes(module.key);
                    return (
                      <button
                        key={module.key}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleModule(module.key)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all",
                          checked
                            ? "border-primary/25 bg-primary/[0.07]"
                            : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-white/20 bg-white/[0.03]",
                          )}
                        >
                          {checked ? <Check className="size-3" /> : null}
                        </span>
                        <span>
                          <span className="block text-[11px] font-medium text-foreground">
                            {module.label}
                          </span>
                          <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                            {module.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors.permissions ? (
                  <p className="mt-1 text-[10px] text-negative">
                    {errors.permissions}
                  </p>
                ) : null}
              </div>

              <p className="flex items-start gap-1.5 rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 text-[9px] leading-relaxed text-muted-foreground/70">
                <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" />
                New accounts receive the standard user role. Administrator
                access is granted separately and unlocks every module.
              </p>
            </div>

            <DialogFooter className="border-t border-white/[0.07] px-5 py-3.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Create user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
