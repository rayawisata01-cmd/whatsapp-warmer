"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Database,
  Users,
  Key,
  User,
  MessageCircle,
  Activity,
  BarChart3,
  Table,
  Trash2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Types
interface DbAccount {
  id: string;
  phoneNumber: string | null;
  name: string | null;
  status: string;
  warmingEnabled: boolean;
  pool: string;
  healthScore: number;
  currentPhase: number;
  warmingDays: number;
  messagesSent: number;
  messagesReceived: number;
  autoResponsesSent: number;
  createdAt: string;
  updatedAt: string;
  personality: {
    name: string;
    age: number;
    occupation: string;
    location: string;
    chronotype: string;
  } | null;
}

interface DbSession {
  id: string;
  accountId: string;
  phoneNumber: string | null;
  hasCreds: boolean;
  hasKeys: boolean;
  lastSync: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbPersonality {
  id: string;
  accountId: string;
  phoneNumber: string | null;
  name: string;
  age: number;
  occupation: string;
  location: string;
  chronotype: string;
  activeHoursStart: number;
  activeHoursEnd: number;
  avgResponseTime: number;
  emojiUsage: string;
  createdAt: string;
}

interface DbChatPair {
  id: string;
  account1Id: string;
  account2Id: string;
  messageCount: number;
  currentTopic: string;
  relationshipStage: string;
  isActive: boolean;
  startedAt: string;
  lastMessageAt: string | null;
}

interface DbLog {
  id: string;
  accountId: string | null;
  type: string;
  message: string;
  timestamp: string;
}

interface DbStats {
  counts: {
    accounts: number;
    sessions: number;
    personalities: number;
    chatPairs: number;
    logs: number;
    messages: number;
    bulkQueue: number;
};
  accountsByStatus: Record<string, number>;
  accountsByPool: Record<string, number>;
  messageStats: {
    totalSent: number;
    totalReceived: number;
    totalAutoResponses: number;
  };
  healthStats: {
    average: number;
    min: number;
    max: number;
  };
  chatPairs: {
    total: number;
    active: number;
  };
  bulkQueue: {
    pending: number;
  };
  logs: {
    last24h: number;
    errors24h: number;
  };
}

export function DatabaseTab() {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("stats");
  const [isLoading, setIsLoading] = useState(false);

  // Data states
  const [stats, setStats] = useState<DbStats | null>(null);
  const [accounts, setAccounts] = useState<DbAccount[]>([]);
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [personalities, setPersonalities] = useState<DbPersonality[]>([]);
  const [chatPairs, setChatPairs] = useState<DbChatPair[]>([]);
  const [logs, setLogs] = useState<DbLog[]>([]);

  // Delete confirmation
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    type: "account" | "session" | "logs";
    id: string;
    name: string;
  }>({ open: false, type: "account", id: "", name: "" });
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch("/api/wa/db/stats");
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  }, []);

  // Fetch accounts
  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/wa/db/accounts");
      if (response.ok) {
        const data = await response.json();
        setAccounts(data.accounts);
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/wa/db/sessions");
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch personalities
  const fetchPersonalities = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/wa/db/personalities");
      if (response.ok) {
        const data = await response.json();
        setPersonalities(data.personalities);
      }
    } catch (error) {
      console.error("Failed to fetch personalities:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch chat pairs
  const fetchChatPairs = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/wa/db/chat-pairs");
      if (response.ok) {
        const data = await response.json();
        setChatPairs(data.chatPairs);
      }
    } catch (error) {
      console.error("Failed to fetch chat pairs:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch logs
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/wa/db/logs?limit=200");
      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
    fetchAccounts();
  }, [fetchStats, fetchAccounts]);

  // Handle section change
  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    switch (section) {
      case "stats":
        fetchStats();
        break;
      case "accounts":
        fetchAccounts();
        break;
      case "sessions":
        fetchSessions();
        break;
      case "personalities":
        fetchPersonalities();
        break;
      case "chatpairs":
        fetchChatPairs();
        break;
      case "logs":
        fetchLogs();
        break;
    }
  };

  // Delete handlers
  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/wa/db/clean/account/${deleteDialog.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        toast({
          title: "Success",
          description: `Account ${deleteDialog.id} deleted successfully`,
        });
        fetchAccounts();
        fetchStats();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to delete account",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete account",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialog({ open: false, type: "account", id: "", name: "" });
    }
  };

  const handleDeleteSession = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/wa/db/clean/session/${deleteDialog.id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        toast({
          title: "Success",
          description: `Session for ${deleteDialog.id} deleted. User will need to scan QR again.`,
        });
        fetchSessions();
        fetchStats();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to delete session",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete session",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialog({ open: false, type: "session", id: "", name: "" });
    }
  };

  const handleClearLogs = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch("/api/wa/db/clean/logs?days=7", {
        method: "DELETE",
      });
      if (response.ok) {
        const data = await response.json();
        toast({
          title: "Success",
          description: data.message,
        });
        fetchLogs();
        fetchStats();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to clear logs",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear logs",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialog({ open: false, type: "logs", id: "", name: "" });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "bg-emerald-500";
      case "offline":
        return "bg-red-500";
      case "connecting":
        return "bg-amber-500";
      default:
        return "bg-slate-400";
    }
  };

  const getPoolColor = (pool: string) => {
    switch (pool) {
      case "active":
        return "bg-emerald-500";
      case "idle":
        return "bg-amber-500";
      default:
        return "bg-slate-400";
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 50) return "text-amber-500";
    return "text-red-500";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Database className="h-6 w-6 text-orange-500" />
            Database Manager
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            View and manage data stored in PostgreSQL database
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { fetchStats(); fetchAccounts(); }}>
          <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Section Tabs */}
      <Tabs value={activeSection} onValueChange={handleSectionChange}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="stats" className="text-xs sm:text-sm">
            <BarChart3 className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Stats</span>
          </TabsTrigger>
          <TabsTrigger value="accounts" className="text-xs sm:text-sm">
            <Users className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Accounts</span>
          </TabsTrigger>
          <TabsTrigger value="sessions" className="text-xs sm:text-sm">
            <Key className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Sessions</span>
          </TabsTrigger>
          <TabsTrigger value="personalities" className="text-xs sm:text-sm">
            <User className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Personalities</span>
          </TabsTrigger>
          <TabsTrigger value="chatpairs" className="text-xs sm:text-sm">
            <MessageCircle className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Chat Pairs</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs sm:text-sm">
            <Activity className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Logs</span>
          </TabsTrigger>
        </TabsList>

        {/* Stats Section */}
        <TabsContent value="stats" className="space-y-4">
          {stats ? (
            <>
              {/* Count Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <Users className="h-5 w-5 mx-auto text-emerald-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.counts.accounts}</p>
                      <p className="text-xs text-slate-500">Accounts</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <Key className="h-5 w-5 mx-auto text-blue-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.counts.sessions}</p>
                      <p className="text-xs text-slate-500">Sessions</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <User className="h-5 w-5 mx-auto text-purple-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.counts.personalities}</p>
                      <p className="text-xs text-slate-500">Personalities</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <MessageCircle className="h-5 w-5 mx-auto text-orange-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.chatPairs.active}</p>
                      <p className="text-xs text-slate-500">Active Pairs</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <Activity className="h-5 w-5 mx-auto text-cyan-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.messageStats.totalSent}</p>
                      <p className="text-xs text-slate-500">Msgs Sent</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <Activity className="h-5 w-5 mx-auto text-green-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.messageStats.totalReceived}</p>
                      <p className="text-xs text-slate-500">Msgs Received</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-center">
                      <BarChart3 className="h-5 w-5 mx-auto text-rose-500 mb-2" />
                      <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.healthStats.average}%</p>
                      <p className="text-xs text-slate-500">Avg Health</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed Stats */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Accounts by Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(stats.accountsByStatus).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn("w-2 h-2 rounded-full", getStatusColor(status))} />
                            <span className="text-sm capitalize">{status}</span>
                          </div>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Accounts by Pool</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(stats.accountsByPool).map(([pool, count]) => (
                        <div key={pool} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn("w-2 h-2 rounded-full", getPoolColor(pool))} />
                            <span className="text-sm capitalize">{pool}</span>
                          </div>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Message Statistics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className="text-xl font-bold text-emerald-500">{stats.messageStats.totalSent}</p>
                        <p className="text-xs text-slate-500">Sent</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-blue-500">{stats.messageStats.totalReceived}</p>
                        <p className="text-xs text-slate-500">Received</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-purple-500">{stats.messageStats.totalAutoResponses}</p>
                        <p className="text-xs text-slate-500">Auto Reply</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Logs (Last 24h)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center">
                        <p className="text-xl font-bold text-slate-900 dark:text-white">{stats.logs.last24h}</p>
                        <p className="text-xs text-slate-500">Total Events</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-red-500">{stats.logs.errors24h}</p>
                        <p className="text-xs text-slate-500">Errors</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          )}
        </TabsContent>

        {/* Accounts Section */}
        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>WhatsApp Accounts</CardTitle>
                  <CardDescription>{accounts.length} accounts in database</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {accounts.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 dark:text-white">{account.id}</span>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {account.phoneNumber && <span>{account.phoneNumber}</span>}
                            {account.personality && <span>• {account.personality.name}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn("text-xs", getStatusColor(account.status))}>
                          {account.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {account.pool}
                        </Badge>
                        <span className={cn("text-xs font-medium", getHealthColor(account.healthScore))}>
                          {account.healthScore}%
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteDialog({ open: true, type: "account", id: account.id, name: account.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {accounts.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No accounts found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sessions Section */}
        <TabsContent value="sessions" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>WhatsApp Sessions</CardTitle>
                  <CardDescription>Auth credentials stored in database for persistence</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-3">
                        <Key className="h-5 w-5 text-blue-500" />
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 dark:text-white">{session.accountId}</span>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            {session.phoneNumber && <span>{session.phoneNumber}</span>}
                            {session.lastSync && <span>• Last sync: {new Date(session.lastSync).toLocaleString()}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={session.hasCreds ? "default" : "secondary"} className="text-xs">
                          {session.hasCreds ? "Has Creds" : "No Creds"}
                        </Badge>
                        <Badge variant={session.hasKeys ? "default" : "secondary"} className="text-xs">
                          {session.hasKeys ? "Has Keys" : "No Keys"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setDeleteDialog({ open: true, type: "session", id: session.accountId, name: session.accountId })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {sessions.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                      <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No sessions found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Personalities Section */}
        <TabsContent value="personalities" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Personalities</CardTitle>
              <CardDescription>AI personas for each account</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {personalities.map((personality) => (
                    <div
                      key={personality.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="font-medium text-slate-900 dark:text-white">{personality.name}</span>
                          <span className="text-sm text-slate-500 ml-2">({personality.age} tahun)</span>
                          <p className="text-xs text-slate-500 mt-1">
                            {personality.occupation} • {personality.location}
                          </p>
                          <p className="text-xs text-slate-400 mt-1">
                            Account: {personality.accountId}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="text-xs capitalize">
                            {personality.chronotype.replace("_", " ")}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            Active: {personality.activeHoursStart}:00 - {personality.activeHoursEnd}:00
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  {personalities.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                      <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No personalities found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Chat Pairs Section */}
        <TabsContent value="chatpairs" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Chat Pairs</CardTitle>
              <CardDescription>Active conversation pairs between accounts</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {chatPairs.map((pair) => (
                    <div
                      key={pair.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-white">{pair.account1Id}</span>
                          <MessageCircle className="h-4 w-4 text-orange-500" />
                          <span className="font-medium text-slate-900 dark:text-white">{pair.account2Id}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={pair.isActive ? "default" : "secondary"} className="text-xs">
                            {pair.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <span className="text-xs text-slate-500">{pair.messageCount} msgs</span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        <span>Topic: {pair.currentTopic}</span>
                        <span className="mx-2">•</span>
                        <span>Stage: {pair.relationshipStage}</span>
                      </div>
                    </div>
                  ))}
                  {chatPairs.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                      <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No chat pairs found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Section */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Event Logs</CardTitle>
                  <CardDescription>System events from database</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteDialog({ open: true, type: "logs", id: "", name: "logs older than 7 days" })}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear Old Logs
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-1">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <span className="text-slate-400 shrink-0 tabular-nums">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {log.type}
                      </Badge>
                      <span className="text-slate-600 dark:text-slate-300 flex-1 truncate">
                        {log.message}
                      </span>
                      {log.accountId && (
                        <span className="text-slate-400 shrink-0">[{log.accountId}]</span>
                      )}
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                      <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No logs found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Confirm Delete
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialog.type === "account" && (
                <>
                  Are you sure you want to delete account <strong>{deleteDialog.id}</strong>? This will also delete all related data including session, personality, messages, and chat pairs.
                </>
              )}
              {deleteDialog.type === "session" && (
                <>
                  Are you sure you want to delete session for <strong>{deleteDialog.id}</strong>? The user will need to scan QR code again to reconnect.
                </>
              )}
              {deleteDialog.type === "logs" && (
                <>Are you sure you want to clear all logs older than 7 days? This action cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteDialog.type === "account") handleDeleteAccount();
                else if (deleteDialog.type === "session") handleDeleteSession();
                else if (deleteDialog.type === "logs") handleClearLogs();
              }}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
