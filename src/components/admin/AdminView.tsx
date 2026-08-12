import { Link } from "@tanstack/react-router";
import { ArrowLeft, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserTable } from "./UserTable";
import { InviteDialog } from "./InviteDialog";
import { AuditLog } from "./AuditLog";

export function AdminView({ currentUserId }: { currentUserId: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-header text-header-foreground">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Users className="size-4" />
          </span>
          <div className="mr-auto">
            <h1 className="text-base font-semibold leading-tight">Usuários</h1>
            <p className="text-[11px] text-muted-foreground">
              Quem acessa a plataforma e o que cada um pode fazer
            </p>
          </div>
          <InviteDialog />
          <Button size="sm" variant="ghost" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" /> Alocações
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 p-4">
        <Tabs defaultValue="usuarios" className="space-y-4">
          <TabsList>
            <TabsTrigger value="usuarios">Usuários</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="usuarios">
            <UserTable currentUserId={currentUserId} />
          </TabsContent>
          <TabsContent value="historico">
            <AuditLog />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
