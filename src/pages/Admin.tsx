import { useMemo, useState, type FormEvent } from "react";
import {
  Bot,
  Check,
  KeyRound,
  Layers,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { BotManagement } from "@/components/bot-management";
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
import { modules } from "@/data/referenceData";
import {
  useCreateUser,
  useDeleteUser,
  useProfiles,
  useUpdateUser,
} from "@/hooks/use-profiles";
import { initials } from "@/lib/format";
import { useSession } from "@/lib/session";
import type {
  ModuleKey,
  UserStatus,
  UserRole,
  WorkspaceUser,
} from "@/types/domain";
import { cn } from "@/lib/utils";

const moduleShortLabel: Record<ModuleKey, string> = {
  ipo: "IPO",
  portfolio: "Portfolio",
  sip: "SIP",
};

type FormErrors = Partial<
  Record<
    "name" | "email" | "password" | "permissions" | "role" | "form",
    string
  >
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
  const { user: currentUser } = useSession();
  const { users, isLoading, error, refetch } = useProfiles(true);
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const updateUser = useUpdateUser();
  const [tab, setTab] = useState<"users" | "bots">("users");
  const [userToDelete, setUserToDelete] = useState<WorkspaceUser | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState<ModuleKey[]>(["ipo"]);
  const [errors, setErrors] = useState<FormErrors>({});

  // Edit user dialog
  const [editUser, setEditUser] = useState<WorkspaceUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("user");
  const [editPermissions, setEditPermissions] = useState<ModuleKey[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [editErrors, setEditErrors] = useState<FormErrors>({});
  const [pendingAction, setPendingAction] = useState<
    "profile" | "password" | null
  >(null);

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

  const openDeleteDialog = (user: WorkspaceUser) => {
    setDeleteError(null);
    setUserToDelete(user);
  };

  const handleDelete = () => {
    if (!userToDelete) return;

    setDeleteError(null);
    deleteUser.mutate(userToDelete.id, {
      onSuccess: () => {
        toast.success(`${userToDelete.name} removed from the workspace`, {
          description:
            "Supabase Auth, profile and portfolio rows were deleted. Recreate the account to restore access.",
        });
        setUserToDelete(null);
      },
      onError: (mutationError) => {
        setDeleteError(mutationError.message);
      },
    });
  };

  const resetEditDialog = () => {
    setEditUser(null);
    setEditName("");
    setEditEmail("");
    setEditRole("user");
    setEditPermissions([]);
    setNewPassword("");
    setEditErrors({});
    setPendingAction(null);
  };

  const clearEditError = (key: keyof FormErrors) => {
    setEditErrors((current) => ({ ...current, [key]: undefined }));
  };

  const openEditDialog = (user: WorkspaceUser) => {
    setEditErrors({});
    setPendingAction(null);
    setEditUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditPermissions([...user.permissions]);
    setNewPassword("");
  };

  const toggleEditModule = (key: ModuleKey) => {
    setEditPermissions((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
    clearEditError("permissions");
  };

  const handleEditSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editUser) return;

    const nextErrors: FormErrors = {};
    const trimmedName = editName.trim();
    const trimmedEmail = editEmail.trim().toLowerCase();

    if (trimmedName.length < 2) {
      nextErrors.name = "Enter the user's full name.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    } else if (
      users.some(
        (user) =>
          user.id !== editUser.id &&
          user.email.toLowerCase() === trimmedEmail,
      )
    ) {
      nextErrors.email = "That email already has access.";
    }
    if (editPermissions.length === 0) {
      nextErrors.permissions = "Assign at least one module.";
    }
    if (editUser.id === currentUser?.id && editRole !== "admin") {
      nextErrors.role = "You cannot remove your own administrator access.";
    }

    setEditErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setPendingAction("profile");
    updateUser.mutate(
      {
        userId: editUser.id,
        fullName: trimmedName,
        email: trimmedEmail,
        role: editRole,
        permissions: editPermissions,
      },
      {
        onSuccess: () => {
          toast.success(`${trimmedName} updated`, {
            description: `Role: ${
              editRole === "admin" ? "Administrator" : "Member"
            } · Modules: ${editPermissions
              .map((item) => moduleShortLabel[item])
              .join(", ")}.`,
          });
          resetEditDialog();
        },
        onError: (mutationError) => {
          setEditErrors((current) => ({
            ...current,
            form: mutationError.message,
          }));
        },
        onSettled: () => {
          setPendingAction(null);
        },
      },
    );
  };

  const handleResetPassword = () => {
    if (!editUser) return;

    if (newPassword.length < 6) {
      setEditErrors((current) => ({
        ...current,
        password: "Use a password with at least 6 characters.",
      }));
      return;
    }

    const targetName = editUser.name;
    setEditErrors((current) => ({
      ...current,
      password: undefined,
      form: undefined,
    }));
    setPendingAction("password");

    updateUser.mutate(
      { userId: editUser.id, password: newPassword },
      {
        onSuccess: () => {
          toast.success(`Password reset for ${targetName}`, {
            description:
              "The new password is active immediately; the previous one no longer works.",
          });
          setNewPassword("");
        },
        onError: (mutationError) => {
          setEditErrors((current) => ({
            ...current,
            password: mutationError.message,
          }));
        },
        onSettled: () => {
          setPendingAction(null);
        },
      },
    );
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

    setErrors({});
    createUser.mutate(
      {
        fullName: trimmedName,
        email: trimmedEmail,
        password,
        permissions: selected,
      },
      {
        onSuccess: () => {
          toast.success(`${trimmedName} added to the workspace`, {
            description: `Supabase Auth account created with access to ${selected
              .map((item) => moduleShortLabel[item])
              .join(", ")}.`,
          });
          handleOpenChange(false);
        },
        onError: (mutationError) => {
          setErrors({ form: mutationError.message });
        },
      },
    );
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin panel"
        description={
          tab === "users"
            ? "Approve who gets into StockPilot, then decide which modules they can open. Permissions govern both the sidebar and the routes behind it."
            : "Register the Telegram bot and review the Hinglish alert templates that the dispatcher will send to your team."
        }
        actions={
          tab === "users" ? (
            <Button
              onClick={() => setOpen(true)}
              size="sm"
              className="primary-glow-sm h-9 gap-1.5 rounded-lg bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <UserPlus className="size-3.5" />
              Create user
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: "users" as const, label: "Workspace users", icon: UsersIcon },
          { key: "bots" as const, label: "Bot management", icon: Bot },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : "border-white/[0.07] bg-white/[0.02] text-muted-foreground hover:border-white/15 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "bots" ? (
        <BotManagement />
      ) : (
        <>
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
            <ShieldCheck
            className="size-3 shrink-0 text-emerald-500"
            strokeWidth={1.5}
          />
            Allowlist enforced
          </span>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-[11px] text-muted-foreground sm:px-5">
            Loading workspace users from Supabase…
          </p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center sm:px-5">
            <p className="text-[11px] text-negative">{error.message}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-[11px] text-primary underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : users.length === 0 ? (
          <p className="px-4 py-10 text-center text-[11px] text-muted-foreground sm:px-5">
            No profiles yet. Create the first user above.
          </p>
        ) : (
          <>
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {[
                  "User",
                  "Role",
                  "Modules",
                  "Status",
                  "Last active",
                  "Actions",
                ].map((heading) => (
                    <th
                      key={heading}
                      className={cn(
                        "px-4 py-2.5 text-left text-[9px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase",
                        heading === "Last active" && "text-right",
                        heading === "Actions" && "pr-5 text-right",
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
                const isSelf = user.id === currentUser?.id;
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
                    <td className="py-3 pr-5 pl-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEditDialog(user)}
                          title={`Edit ${user.name}`}
                          aria-label={`Edit ${user.name}`}
                          className="grid size-8 place-items-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-primary/25 hover:bg-primary/10 hover:text-primary"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteDialog(user)}
                          disabled={isSelf}
                          title={
                            isSelf
                              ? "You cannot remove your own account"
                              : `Remove ${user.name}`
                          }
                          aria-label={`Remove ${user.name}`}
                          className="grid size-8 place-items-center rounded-lg border border-transparent text-negative/75 transition-all duration-200 hover:-translate-y-0.5 hover:border-negative/25 hover:bg-negative/10 hover:text-negative disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Trash2
                            className="size-3.5 shrink-0 text-red-500"
                            strokeWidth={1.5}
                          />
                        </button>
                      </div>
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
                  <div className="flex shrink-0 items-center gap-1.5">
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
                    <button
                      type="button"
                      onClick={() => openEditDialog(user)}
                      title={`Edit ${user.name}`}
                      aria-label={`Edit ${user.name}`}
                      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openDeleteDialog(user)}
                      disabled={user.id === currentUser?.id}
                      title={
                        user.id === currentUser?.id
                          ? "You cannot remove your own account"
                          : `Remove ${user.name}`
                      }
                      aria-label={`Remove ${user.name}`}
                      className="grid size-7 place-items-center rounded-md text-negative/75 transition-all duration-200 hover:-translate-y-0.5 hover:bg-negative/10 hover:text-negative disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2
                        className="size-3.5 shrink-0 text-red-500"
                        strokeWidth={1.5}
                      />
                    </button>
                  </div>
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
          </>
        )}

        <div className="border-t border-white/[0.06] px-4 py-3 text-[9px] text-muted-foreground/70 sm:px-5">
          Users are created, updated and removed through the
          admin-create-user, admin-update-user and admin-delete-user Edge
          Functions. Profile rows, permissions and portfolio holdings follow the
          Supabase Auth account.
        </div>
      </section>

      <section className="glass rounded-2xl p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md border border-primary/20 bg-primary/10">
            <ShieldCheck
            className="size-3 shrink-0 text-emerald-500"
            strokeWidth={1.5}
          />
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
        </>
      )}

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
                <ShieldCheck
              className="mt-0.5 size-3 shrink-0 text-emerald-500"
              strokeWidth={1.5}
            />
                New accounts receive the standard user role. Administrator
                access is granted separately and unlocks every module.
              </p>

              {errors.form ? (
                <p className="rounded-lg border border-negative/25 bg-negative/10 px-2.5 py-2 text-[10px] leading-relaxed text-negative">
                  {errors.form}
                </p>
              ) : null}
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
                disabled={createUser.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {createUser.isPending ? "Creating account…" : "Create user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={userToDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleteUser.isPending) {
            setUserToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="glass-deep gap-0 overflow-hidden border-white/10 p-0 sm:max-w-md">
          <DialogHeader className="border-b border-white/[0.07] px-5 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 font-display text-base">
              <Trash2 className="size-4 text-negative" />
              Remove user
            </DialogTitle>
            <DialogDescription className="mt-1 text-[11px] leading-relaxed">
              This permanently deletes{" "}
              <span className="font-medium text-foreground">
                {userToDelete?.name}
              </span>{" "}
              from Supabase Auth and removes their profile, module access and
              portfolio rows. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-4">
            <div className="rounded-xl border border-negative/20 bg-negative/[0.06] p-3">
              <p className="text-[11px] font-medium text-foreground">
                {userToDelete?.email}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {userToDelete?.role === "admin"
                  ? "Administrator"
                  : "Member"}{" "}
                ·{" "}
                {userToDelete && userToDelete.permissions.length > 0
                  ? userToDelete.permissions
                      .map((permission) => moduleShortLabel[permission])
                      .join(", ")
                  : "No modules"}
              </p>
            </div>

            {deleteError ? (
              <p className="rounded-lg border border-negative/25 bg-negative/10 px-2.5 py-2 text-[10px] leading-relaxed text-negative">
                {deleteError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-white/[0.07] px-5 py-3.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setUserToDelete(null);
                setDeleteError(null);
              }}
              disabled={deleteUser.isPending}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? "Removing account…" : "Remove user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editUser !== null}
        onOpenChange={(next) => {
          if (!next && !updateUser.isPending) {
            resetEditDialog();
          }
        }}
      >
        <DialogContent className="glass-deep gap-0 overflow-hidden border-white/10 p-0 sm:max-w-md">
          <form onSubmit={handleEditSubmit}>
            <DialogHeader className="border-b border-white/[0.07] px-5 py-4 text-left">
              <DialogTitle className="flex items-center gap-2 font-display text-base">
                <Pencil className="size-4 text-primary" />
                Edit user
              </DialogTitle>
              <DialogDescription className="mt-1 text-[11px] leading-relaxed">
                Update account details and module access for{" "}
                <span className="font-medium text-foreground">
                  {editUser?.name}
                </span>
                , or reset the password below.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-3.5 overflow-y-auto px-5 py-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="edit-name"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Name
                </label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(event) => {
                    setEditName(event.target.value);
                    clearEditError("name");
                  }}
                  placeholder="Ananya Deshpande"
                  autoComplete="off"
                  className="h-10 border-white/10 bg-black/30 text-[12px]"
                />
                {editErrors.name ? (
                  <p className="text-[10px] text-negative">
                    {editErrors.name}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="edit-email"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Email
                </label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editEmail}
                  onChange={(event) => {
                    setEditEmail(event.target.value);
                    clearEditError("email");
                  }}
                  placeholder="ananya@stockpilot.io"
                  autoComplete="off"
                  className="h-10 border-white/10 bg-black/30 text-[12px]"
                />
                {editErrors.email ? (
                  <p className="text-[10px] text-negative">
                    {editErrors.email}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Role
                </p>
                <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/25 p-1">
                  {(["user", "admin"] as UserRole[]).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => {
                        setEditRole(role);
                        clearEditError("role");
                      }}
                      className={cn(
                        "flex-1 rounded-md px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase transition-colors",
                        editRole === role
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {role === "admin" ? "Administrator" : "Member"}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/70">
                  Administrators unlock the Admin Panel and every module.
                </p>
                {editErrors.role ? (
                  <p className="mt-1 text-[10px] text-negative">
                    {editErrors.role}
                  </p>
                ) : null}
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted-foreground">
                  Module access
                </p>
                <div className="mt-2 space-y-2">
                  {modules.map((module) => {
                    const checked = editPermissions.includes(module.key);
                    return (
                      <button
                        key={module.key}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleEditModule(module.key)}
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
                {editErrors.permissions ? (
                  <p className="mt-1 text-[10px] text-negative">
                    {editErrors.permissions}
                  </p>
                ) : null}
              </div>

              <div className="border-t border-white/[0.07] pt-3.5">
                <div className="flex items-start gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md border border-negative/20 bg-negative/10">
                    <KeyRound className="size-3 text-negative" />
                  </span>
                  <div>
                    <p className="text-[11px] font-medium text-foreground">
                      Reset password
                    </p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                      Supabase stores only a secure hash, so the current
                      password cannot be displayed or recovered. Type a new one
                      to replace it.
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="edit-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      clearEditError("password");
                    }}
                    placeholder="New password (min. 6 characters)"
                    autoComplete="new-password"
                    className="h-10 flex-1 border-white/10 bg-black/30 text-[12px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleResetPassword}
                    disabled={
                      updateUser.isPending && pendingAction === "password"
                    }
                    className="h-10 shrink-0 gap-1.5 rounded-lg border border-negative/25 bg-negative/10 px-3 text-[11px] font-semibold text-negative hover:bg-negative/15 hover:text-negative"
                  >
                    <KeyRound className="size-3.5" />
                    {pendingAction === "password" && updateUser.isPending
                      ? "Resetting…"
                      : "Reset password"}
                  </Button>
                </div>

                {editErrors.password ? (
                  <p className="mt-1.5 text-[10px] text-negative">
                    {editErrors.password}
                  </p>
                ) : null}
              </div>

              {editErrors.form ? (
                <p className="rounded-lg border border-negative/25 bg-negative/10 px-2.5 py-2 text-[10px] leading-relaxed text-negative">
                  {editErrors.form}
                </p>
              ) : null}
            </div>

            <DialogFooter className="border-t border-white/[0.07] px-5 py-3.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetEditDialog}
                disabled={updateUser.isPending}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  updateUser.isPending && pendingAction === "profile"
                }
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {pendingAction === "profile" && updateUser.isPending
                  ? "Saving changes…"
                  : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
