"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import {
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
  Loader2,
  QrCode,
  Hash,
  Trash2,
  Flame,
  Moon,
  Zap,
  RotateCw,
  Shield,
  Server,
  Globe,
  AlertTriangle,
  MoreVertical,
  Eye,
  User,
  Calendar,
  Activity,
  LayoutDashboard,
  HardDrive,
  Users,
  MessageCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Bot,
  Inbox,
  LogOut,
  Terminal,
  Sun,
  Clock,
  Sparkles,
  Heart,
  MapPin,
  Briefcase,
  Smile,
  Star,
  TrendingUp,
  Layers,
  FileSpreadsheet,
  Download,
  Upload,
  CheckCircle,
  Settings,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ==================== TYPES ====================

interface RateLimit {
  hour: number;
  day: number;
  maxHour: number;
  maxDay: number;
}

interface Personality {
  name: string;
  age: number;
  occupation: string;
  location: string;
  traits?: string[];
  hobbies?: string[];
  writingStyle?: string;
  responseStyle?: string;
  chronotype?: 'early_bird' | 'night_owl' | 'regular' | 'flexible';
  activeHoursStart?: number;
  activeHoursEnd?: number;
  peakHours?: number[];
  avgResponseTime?: number;
  emojiUsage?: 'heavy' | 'moderate' | 'minimal';
  avgMessageLength?: 'short' | 'medium' | 'long';
}

interface Account {
  id: string;
  phoneNumber?: string;
  name?: string;
  profilePicture?: string;
  status: "online" | "offline" | "connecting";
  qrCode?: string;
  pairingCode?: string;
  warmingEnabled: boolean;
  warmingStats?: {
    healthScore: number;
    messagesSent: number;
    messagesReceived: number;
    autoResponsesSent: number;
    warmingStartTime?: Date;
    lastActivity?: Date;
  };
  personality?: Personality | null;
  pool?: "active" | "idle" | "offline";
  rateLimit?: RateLimit;
  warmingPhase?: number;
  warmingDays?: number;
  isInActiveWindow?: boolean;
}

interface BannedAccount {
  id: string;
  daysActive: number;
  messagesSent: number;
  messagesReceived: number;
  banCount: number;
  lastBanDate?: string;
  replacement?: string;
}

interface Log {
  id: string;
  type: "message" | "connection" | "error" | "info" | "warming" | "pool";
  message: string;
  timestamp: Date;
}

interface ChatMessage {
  id: string;
  accountId: string;
  text: string;
  timestamp: Date;
  direction: 'incoming' | 'outgoing';
  isAutoResponse?: boolean;
}

interface ChatPair {
  id: string;
  account1: { id: string; name: string };
  account2: { id: string; name: string };
  currentTopic: string;
  topicCategory: string;
  messageCount: number;
  relationshipStage: string;
  relationshipLabel: string;
  sharedInterests: string[];
  topicsDiscussed: string[];
  startedAt: string;
  lastMessageAt?: string;
  // Natural decay info
  silenceCount: number;
  maxSilenceCount: number;
  lastRespondedAt?: string;
}

export default function Dashboard() {
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatPairs, setChatPairs] = useState<ChatPair[]>([]);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [newAccountId, setNewAccountId] = useState("");
  const [authMethod, setAuthMethod] = useState<"qr" | "pairing">("qr");
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [poolViewMode, setPoolViewMode] = useState<"all" | "active" | "idle" | "offline">("all");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [deleteAccountDialog, setDeleteAccountDialog] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null });
  const [accountDetail, setAccountDetail] = useState<{ open: boolean; account: Account | null }>({ open: false, account: null });
  const [isDeleting, setIsDeleting] = useState(false);
  const [qrModal, setQrModal] = useState<{ open: boolean; qrCode: string; accountId: string }>({ open: false, qrCode: "", accountId: "" });
  
  // Bulk creation states
  const [addMode, setAddMode] = useState<"single" | "bulk" | "excel">("single");
  const [bulkCount, setBulkCount] = useState("");
  const [bulkPrefix, setBulkPrefix] = useState("warmer");
  const [excelUploadResult, setExcelUploadResult] = useState<{ total: number; accounts: Array<{ accountId: string; phoneNumber?: string; usePairingCode: boolean }> } | null>(null);
  const [bulkQueueStatus, setBulkQueueStatus] = useState<{ total: number; completed: number; pending: number; failed: number; isProcessing: boolean } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Banned accounts state
  const [bannedAccounts, setBannedAccounts] = useState<BannedAccount[]>([]);
  const [showBannedSection, setShowBannedSection] = useState(false);

  // AI Settings state
  const [aiSettings, setAiSettings] = useState<{
    provider: string;
    groqApiKey: string;
    groqModel: string;
    hasGroqKey: boolean;
    lastUpdated?: string;
  }>({
    provider: 'groq',
    groqApiKey: '',
    groqModel: 'llama-3.3-70b-versatile',
    hasGroqKey: false,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; response?: string; error?: string } | null>(null);

  const { toast } = useToast();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<Socket | null>(null);
  
  // FIX: Prevent double connection and track reconnection state
  const isConnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const manualReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Exponential backoff configuration
  const RECONNECT_BASE_DELAY = 1000; // 1 second
  const RECONNECT_MAX_DELAY = 30000; // 30 seconds
  const MAX_RECONNECT_ATTEMPTS = 10; // Match socket.io reconnectionAttempts

  // WebSocket connection for real-time updates
  useEffect(() => {
    // FIX: Prevent double connection in React Strict Mode
    if (isConnectingRef.current || socketRef.current?.connected) {
      console.log('[WS] Already connecting or connected, skipping...');
      return;
    }

    // REMOVED: Manual heartbeat - Socket.io handles ping/pong automatically
    // Server configured with pingInterval: 30000, pingTimeout: 120000
    // Client configured with timeout: 120000
    // This should be sufficient for keeping the connection alive

    // FIX: Exponential backoff for manual reconnection
    const scheduleReconnect = () => {
      if (manualReconnectTimeoutRef.current) {
        clearTimeout(manualReconnectTimeoutRef.current);
      }
      
      const attempts = reconnectAttemptsRef.current;
      const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, attempts) + Math.random() * 1000,
        RECONNECT_MAX_DELAY
      );
      
      console.log(`[WS] Scheduling reconnect attempt ${attempts + 1} in ${Math.round(delay)}ms`);
      
      manualReconnectTimeoutRef.current = setTimeout(() => {
        if (socketRef.current && !socketRef.current.connected && !isConnectingRef.current) {
          reconnectAttemptsRef.current++;
          console.log('[WS] Attempting manual reconnect...');
          socketRef.current.connect();
        }
      }, delay);
    };

    // Handle visibility change - reconnect if disconnected while tab was hidden
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WS] Tab visible again, checking connection...');
        if (socketRef.current && !socketRef.current.connected && !isConnectingRef.current) {
          // Reset reconnect attempts on visibility restore
          reconnectAttemptsRef.current = 0;
          socketRef.current.connect();
        }
        // Note: Socket.io handles its own keepalive, no need for manual ping
      }
    };

    // FIX: Health check before connecting with retry delay
    const checkHealthAndConnect = async () => {
      let serviceReady = false;
      
      try {
        console.log('[WS] Checking WhatsApp service health...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const healthResponse = await fetch('/api/wa/health', { 
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (healthResponse.ok) {
          const health = await healthResponse.json();
          console.log('[WS] Health check passed:', health);
          serviceReady = true;
        } else {
          console.warn('[WS] Health check returned:', healthResponse.status);
        }
      } catch (error) {
        console.warn('[WS] Health check error:', error);
      }
      
      // FIX: If service not ready, wait before connecting
      if (!serviceReady) {
        console.log('[WS] Service not ready, waiting 2 seconds before connecting...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      connectSocket();
    };
    
    const connectSocket = () => {
      if (isConnectingRef.current) return;
      isConnectingRef.current = true;
      
      // ========================================
      // CRITICAL CONFIGURATION FOR RAILWAY
      // ========================================
      // Use default /socket.io path (NO /api/ prefix)
      // WebSocket first, polling as fallback
      // Custom server handles WebSocket upgrade properly
      const socketOptions = {
        path: '/socket.io',                    // DEFAULT PATH - cleanest approach
        transports: ['websocket', 'polling'],  // WebSocket first for better performance
        upgrade: true,                         // Allow transport upgrade
        reconnection: true,
        reconnectionAttempts: 15,              // More attempts for Railway
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,           // Max 10s between retries
        randomizationFactor: 0.5,              // Add jitter
        timeout: 45000,                        // 45 seconds - reasonable timeout
        forceNew: true,
        autoConnect: true,
      };

      const socketUrl = window.location.origin;
      console.log('[Socket.io] Connecting...', { 
        url: socketUrl, 
        path: '/socket.io',
        timeout: '45s',
        transports: ['websocket', 'polling']
      });
      
      socketRef.current = io(socketUrl, socketOptions);
      const socket = socketRef.current;
      isConnectingRef.current = false;

      socket.on('connect', () => {
        // Log the transport being used
        const transport = socket.io.engine.transport.name;
        console.log(`[Socket.io] Connected! ID: ${socket.id} | Transport: ${transport}`);
        setConnected(true);
        // FIX: Reset reconnection attempts on successful connect
        reconnectAttemptsRef.current = 0;
        
        // Request initial data immediately
        socket.emit('get-accounts');
        socket.emit('get-logs');
      });

      // Log when transport upgrades (e.g., from polling to websocket)
      socket.io.engine.on('upgrade', (transport: any) => {
        console.log(`[Socket.io] Transport upgraded to: ${transport.name}`);
      });

      socket.on('connect_error', (error: Error) => {
        console.error('[WS] Connection error:', error.message);
        setConnected(false);
        // Schedule manual reconnect with exponential backoff
        scheduleReconnect();
      });

      socket.on('disconnect', (reason) => {
        console.log('[WS] Disconnected from WhatsApp service, reason:', reason);
        setConnected(false);
        
        // Socket.io will auto-reconnect for most reasons
        // Only force manual reconnect for server-initiated disconnect or transport error
        if (reason === 'io server disconnect' || reason === 'transport error') {
          // FIX: Check if we haven't exceeded max attempts
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            scheduleReconnect();
          } else {
            console.error('[WS] Max reconnection attempts reached, please refresh the page');
          }
        }
      });

      // Handle real-time events
      socket.on('init', (data: { accounts: Account[]; logs: Log[]; chatPairs: ChatPair[] }) => {
        if (data.accounts) {
          setAccounts(data.accounts.map((acc: any) => ({
            ...acc,
            vpsId: 'local',
          })));
        }
        if (data.logs) {
          setLogs(data.logs.map((l: Log) => ({ ...l, timestamp: new Date(l.timestamp) })));
        }
        if (data.chatPairs) {
          setChatPairs(data.chatPairs);
        }
      });

      socket.on('log', (log: Log) => {
        setLogs(prev => [{ ...log, timestamp: new Date(log.timestamp) }, ...prev].slice(0, 500));
      });

      socket.on('account-status', ({ accountId, status }: { accountId: string; status: string }) => {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, status: status as any } : a));
      });

      socket.on('qr-code', ({ accountId, qr }: { accountId: string; qr: string }) => {
        console.log('[WS] QR Code received:', { accountId, qrPreview: qr?.substring(0, 50) });
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, qrCode: qr } : a));
      });

      socket.on('pairing-code', ({ accountId, code }: { accountId: string; code: string }) => {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, pairingCode: code } : a));
      });

      socket.on('account-info', ({ accountId, phoneNumber, name, profilePicture }: { accountId: string; phoneNumber?: string; name?: string; profilePicture?: string }) => {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, phoneNumber, name, profilePicture } : a));
      });

      socket.on('warming-stats', ({ accountId, stats }: { accountId: string; stats: any }) => {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, warmingStats: stats } : a));
      });

      socket.on('pool-change', ({ accountId, pool }: { accountId: string; pool: string }) => {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, pool: pool as any } : a));
      });

      socket.on('message', (msg: ChatMessage) => {
        setChatMessages(prev => [{ ...msg, timestamp: new Date(msg.timestamp) }, ...prev].slice(0, 100));
      });
    };

    // Add visibility change listener at useEffect level
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start connection
    checkHealthAndConnect();

    // FIX: Cleanup function must clear all timers and refs
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      // Clear manual reconnect timeout
      if (manualReconnectTimeoutRef.current) {
        clearTimeout(manualReconnectTimeoutRef.current);
        manualReconnectTimeoutRef.current = null;
      }
      
      // Disconnect socket properly
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      
      // Reset all refs
      isConnectingRef.current = false;
      reconnectAttemptsRef.current = 0;
    };
  }, []);

  // Local mode - direct connection to WhatsApp service (fallback HTTP)
  const fetchAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/wa/accounts");
      if (response.ok) {
        const data = await response.json();
        // Transform data for local mode
        const transformed = data.map((acc: any) => ({
          ...acc,
          vpsId: 'local',
        }));
        setAccounts(transformed);
        setConnected(true);
      }
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
      setConnected(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch("/api/wa/logs");
      if (response.ok) {
        const data = await response.json();
        setLogs(data.map((l: Log) => ({ ...l, timestamp: new Date(l.timestamp) })));
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    }
  }, []);

  const fetchChatPairs = useCallback(async () => {
    try {
      const response = await fetch("/api/wa/chat-pairs");
      if (response.ok) {
        const data = await response.json();
        setChatPairs(data);
      }
    } catch (error) {
      console.error("Failed to fetch chat pairs:", error);
    }
  }, []);

  const fetchBannedAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/wa/burnable/banned");
      if (response.ok) {
        const data = await response.json();
        setBannedAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error("Failed to fetch banned accounts:", error);
    }
  }, []);

  const clearBannedStatus = useCallback(async (accountId: string) => {
    try {
      const response = await fetch(`/api/wa/banned/clear/${accountId}`, { method: 'POST' });
      if (response.ok) {
        toast({
          title: "Success",
          description: `Banned status cleared for ${accountId}`,
        });
        fetchBannedAccounts();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to clear banned status",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to clear banned status",
        variant: "destructive",
      });
    }
  }, [fetchBannedAccounts, toast]);

  const resetPersonality = useCallback(async (accountId: string) => {
    try {
      const response = await fetch(`/api/wa/personality/reset/${accountId}`, { method: 'POST' });
      if (response.ok) {
        toast({
          title: "Success",
          description: `Personality reset for ${accountId}`,
        });
        fetchBannedAccounts();
        fetchAccounts();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to reset personality",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reset personality",
        variant: "destructive",
      });
    }
  }, [fetchBannedAccounts, fetchAccounts, toast]);

  // Fetch AI settings
  const fetchAiSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/wa/ai-settings");
      if (response.ok) {
        const data = await response.json();
        setAiSettings({
          provider: data.provider || 'groq',
          groqApiKey: data.groqApiKey || '',
          groqModel: data.groqModel || 'llama-3.3-70b-versatile',
          hasGroqKey: data.hasGroqKey || false,
          lastUpdated: data.lastUpdated,
        });
      }
    } catch (error) {
      console.error("Failed to fetch AI settings:", error);
    }
  }, []);

  // Save AI settings
  const saveAiSettings = useCallback(async () => {
    setIsSavingSettings(true);
    try {
      const response = await fetch("/api/wa/ai-settings", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiSettings.provider,
          groqApiKey: aiSettings.groqApiKey,
          groqModel: aiSettings.groqModel,
        }),
      });
      
      if (response.ok) {
        toast({
          title: "Success",
          description: "AI settings saved successfully",
        });
        fetchAiSettings();
      } else {
        const data = await response.json();
        toast({
          title: "Error",
          description: data.error || "Failed to save settings",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save AI settings",
        variant: "destructive",
      });
    } finally {
      setIsSavingSettings(false);
    }
  }, [aiSettings, fetchAiSettings, toast]);

  // Test AI connection
  const testAiConnection = useCallback(async () => {
    setIsTestingAi(true);
    setAiTestResult(null);
    try {
      const response = await fetch("/api/wa/ai-settings/test", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await response.json();
      setAiTestResult({
        success: data.success,
        response: data.response,
        error: data.error,
      });
      
      if (data.success) {
        toast({
          title: "Success",
          description: `AI connection successful via ${data.provider}`,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (error) {
      setAiTestResult({
        success: false,
        error: "Failed to test connection",
      });
      toast({
        title: "Error",
        description: "Failed to test AI connection",
        variant: "destructive",
      });
    } finally {
      setIsTestingAi(false);
    }
  }, [toast]);

  // Initialize - fetch initial data (WebSocket will handle updates)
  useEffect(() => {
    fetchAccounts();
    fetchLogs();
    fetchChatPairs();
    fetchBannedAccounts();
    fetchAiSettings();
  }, [fetchAccounts, fetchLogs, fetchChatPairs, fetchBannedAccounts, fetchAiSettings]);

  // Generate chat messages from logs
  useEffect(() => {
    const messages: ChatMessage[] = logs
      .filter(l => l.type === 'message' || l.type === 'warming')
      .slice(0, 50)
      .map(l => {
        const isOutgoing = l.message.includes('📤') || l.message.includes('Auto-reply') || l.message.includes('sent');
        return {
          id: l.id,
          accountId: l.message.match(/\[([^\]]+)\]/)?.[1] || 'unknown',
          text: l.message.replace(/[📥📤💬⏳]/g, '').replace(/\[[^\]]+\]/, '').trim(),
          timestamp: l.timestamp,
          direction: isOutgoing ? 'outgoing' : 'incoming',
          isAutoResponse: l.message.includes('Auto-reply')
        };
      });
    setChatMessages(messages);
  }, [logs]);

  // Fallback polling (only if WebSocket is disconnected)
  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    // Poll every 10 seconds as fallback
    pollingRef.current = setInterval(() => {
      if (!socketRef.current?.connected) {
        fetchAccounts();
        fetchLogs();
        fetchChatPairs();
      }
    }, 10000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchAccounts, fetchLogs, fetchChatPairs]);

  // Start session
  const handleStartSession = useCallback(async () => {
    if (!newAccountId.trim()) {
      toast({ title: "Error", description: "Enter Account ID", variant: "destructive" });
      return;
    }

    try {
      const response = await fetch("/api/wa/session/start", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: newAccountId.trim(),
          usePairingCode: authMethod === "pairing",
          phoneNumber: authMethod === "pairing" ? newPhoneNumber.trim() : undefined,
        }),
      });

      if (response.ok) {
        toast({ title: "Session Started", description: `Account ${newAccountId}` });
        setAddAccountOpen(false);
        setNewAccountId("");
        setNewPhoneNumber("");
        fetchAccounts();
      } else {
        const data = await response.json();
        toast({ title: "Error", description: data.error || "Failed to start session", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to start session", variant: "destructive" });
    }
  }, [newAccountId, authMethod, newPhoneNumber, toast, fetchAccounts]);

  // Delete Account
  const handleDeleteAccount = useCallback(async () => {
    if (!deleteAccountDialog.account) return;
    
    const account = deleteAccountDialog.account;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/wa/account/${account.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({ title: "Account Deleted", description: `${account.personality?.name || account.id} has been removed` });
        setDeleteAccountDialog({ open: false, account: null });
        fetchAccounts();
      } else {
        const data = await response.json();
        toast({ title: "Error", description: data.error || "Failed to delete account", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete account", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteAccountDialog.account, toast, fetchAccounts]);

  // Rotate pools
  const handleRotatePools = useCallback(async () => {
    try {
      await fetch("/api/wa/pool/rotate", { method: 'POST' });
      toast({ title: "Pool Rotation", description: "Rotating pools..." });
    } catch (error) {
      toast({ title: "Error", description: "Failed to rotate pools", variant: "destructive" });
    }
  }, [toast]);

  // Retry Connection (for QR/Pairing issues)
  const handleRetryConnection = useCallback(async (accountId: string) => {
    try {
      const response = await fetch(`/api/wa/session/retry/${accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Retrying Connection",
          description: `Retrying connection for ${accountId}...`,
        });
        fetchAccounts();
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to retry connection",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to retry connection",
        variant: "destructive",
      });
    }
  }, [toast, fetchAccounts]);

  // Excel upload handler
  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setExcelUploadResult(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/wa/bulk/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setExcelUploadResult({
          total: data.total,
          accounts: data.accounts
        });
        toast({ 
          title: "Excel Parsed", 
          description: `${data.total} accounts found in file` 
        });
      } else {
        toast({ 
          title: "Error", 
          description: data.error || "Failed to parse Excel", 
          variant: "destructive" 
        });
      }
    } catch (error) {
      toast({ 
        title: "Error", 
        description: "Failed to upload Excel file", 
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  }, [toast]);

  // Download template handler
  const handleDownloadTemplate = useCallback(() => {
    window.open('/api/wa/bulk/template', '_blank');
  }, []);

  // Fetch bulk queue status
  const fetchBulkQueueStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/wa/bulk/queue');
      if (response.ok) {
        const data = await response.json();
        setBulkQueueStatus({
          total: data.summary.total,
          completed: data.summary.completed,
          pending: data.summary.pending,
          failed: data.summary.failed,
          isProcessing: data.summary.isProcessing
        });
      }
    } catch (error) {
      console.error('Failed to fetch bulk queue status:', error);
    }
  }, []);

  // Handle add account (single, bulk, or excel)
  const handleAddAccount = useCallback(async () => {
    if (addMode === 'single') {
      // Existing single session logic
      if (!newAccountId.trim()) {
        toast({ title: "Error", description: "Enter Account ID", variant: "destructive" });
        return;
      }

      try {
        console.log('[DEBUG] Starting session for:', newAccountId.trim(), 'method:', authMethod);
        
        const response = await fetch("/api/wa/session/start", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: newAccountId.trim(),
            usePairingCode: authMethod === "pairing",
            phoneNumber: authMethod === "pairing" ? newPhoneNumber.trim() : undefined,
          }),
        });

        const data = await response.json();
        console.log('[DEBUG] Session start response:', response.status, data);

        if (response.ok) {
          toast({ title: "Session Started", description: `Account ${newAccountId}` });
          setAddAccountOpen(false);
          setNewAccountId("");
          setNewPhoneNumber("");
          fetchAccounts();
        } else {
          console.error('[ERROR] Session start failed:', data);
          toast({ title: "Error", description: data.error || "Failed to start session", variant: "destructive" });
        }
      } catch (error) {
        toast({ title: "Error", description: "Failed to start session", variant: "destructive" });
      }
    } else if (addMode === 'bulk') {
      // Bulk queue mode - create accounts one by one
      const count = parseInt(bulkCount);
      if (!count || count <= 0) {
        toast({ title: "Error", description: "Enter valid account count", variant: "destructive" });
        return;
      }
      if (!bulkPrefix.trim()) {
        toast({ title: "Error", description: "Enter account prefix", variant: "destructive" });
        return;
      }

      try {
        const accountIds = Array.from({ length: count }, (_, i) => `${bulkPrefix.trim()}-${i + 1}`);
        
        const response = await fetch("/api/wa/session/batch-start", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountIds,
            usePairingCodes: Array(count).fill(authMethod === 'pairing'),
            phoneNumbers: authMethod === 'pairing' ? Array(count).fill('') : undefined
          }),
        });

        if (response.ok) {
          const data = await response.json();
          toast({ 
            title: "Bulk Queue Started", 
            description: `${count} accounts added to queue` 
          });
          setAddAccountOpen(false);
          setBulkCount("");
          fetchAccounts();
        } else {
          const data = await response.json();
          toast({ title: "Error", description: data.error || "Failed to start bulk queue", variant: "destructive" });
        }
      } catch (error) {
        toast({ title: "Error", description: "Failed to start bulk queue", variant: "destructive" });
      }
    } else if (addMode === 'excel') {
      // Excel mode - start processing uploaded data
      if (!excelUploadResult) {
        toast({ title: "Error", description: "Upload Excel file first", variant: "destructive" });
        return;
      }

      try {
        const response = await fetch("/api/wa/bulk/start", {
          method: 'POST',
        });

        if (response.ok) {
          toast({ 
            title: "Processing Started", 
            description: `${excelUploadResult.total} accounts being processed` 
          });
          fetchBulkQueueStatus();
          // Start polling for queue status
          pollingRef.current = setInterval(fetchBulkQueueStatus, 3000);
        } else {
          const data = await response.json();
          toast({ title: "Error", description: data.error || "Failed to start processing", variant: "destructive" });
        }
      } catch (error) {
        toast({ title: "Error", description: "Failed to start processing", variant: "destructive" });
      }
    }
  }, [addMode, newAccountId, authMethod, newPhoneNumber, bulkCount, bulkPrefix, excelUploadResult, toast, fetchAccounts, fetchBulkQueueStatus]);

  // Helpers
  const getStatusColor = (status: string) => {
    switch (status) {
      case "online": return "bg-emerald-500";
      case "offline": return "bg-red-500";
      case "connecting": return "bg-amber-500";
      default: return "bg-slate-400";
    }
  };

  const getPoolColor = (pool?: string) => {
    switch (pool) {
      case "active": return "bg-emerald-500";
      case "idle": return "bg-amber-500";
      default: return "bg-slate-400";
    }
  };

  const getLogColor = (type: Log["type"]) => {
    switch (type) {
      case "message": return "text-emerald-600 dark:text-emerald-400";
      case "connection": return "text-cyan-600 dark:text-cyan-400";
      case "error": return "text-red-600 dark:text-red-400";
      case "warming": return "text-orange-600 dark:text-orange-400";
      default: return "text-slate-600 dark:text-slate-400";
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 50) return "text-amber-500";
    return "text-red-500";
  };

  // Chronotype helpers
  const getChronotypeInfo = (chronotype?: Personality['chronotype']) => {
    switch (chronotype) {
      case 'early_bird':
        return { label: 'Early Bird', icon: Sun, color: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-500/20', desc: 'Aktif pagi, tidur malam' };
      case 'night_owl':
        return { label: 'Night Owl', icon: Moon, color: 'text-purple-500', bg: 'bg-purple-100 dark:bg-purple-500/20', desc: 'Bangun siang, aktif malam' };
      case 'regular':
        return { label: 'Regular', icon: Clock, color: 'text-blue-500', bg: 'bg-blue-100 dark:bg-blue-500/20', desc: 'Jadwal normal' };
      case 'flexible':
        return { label: 'Flexible', icon: Zap, color: 'text-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-500/20', desc: 'Fleksibel, bisa kapan saja' };
      default:
        return { label: 'Unknown', icon: Clock, color: 'text-slate-500', bg: 'bg-slate-100', desc: '' };
    }
  };

  const formatHour = (hour: number): string => {
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    if (hour < 12) return `${hour} AM`;
    return `${hour - 12} PM`;
  };

  const getEmojiUsageLabel = (usage?: Personality['emojiUsage']) => {
    switch (usage) {
      case 'heavy': return { label: 'Banyak Emoji', emoji: '😊🎉👍' };
      case 'moderate': return { label: 'Sedang', emoji: '😊👍' };
      case 'minimal': return { label: 'Minimal', emoji: '👍' };
      default: return { label: 'Normal', emoji: '' };
    }
  };

  const getMessageLengthLabel = (length?: Personality['avgMessageLength']) => {
    switch (length) {
      case 'short': return 'Singkat';
      case 'medium': return 'Sedang';
      case 'long': return 'Panjang';
      default: return 'Normal';
    }
  };

  // Stats
  const stats = {
    totalAccounts: accounts.length,
    onlineAccounts: accounts.filter(a => a.status === 'online').length,
    warmingAccounts: accounts.filter(a => a.warmingEnabled && a.status === 'online').length,
    activePool: accounts.filter(a => a.pool === 'active').length,
    idlePool: accounts.filter(a => a.pool === 'idle').length,
    totalMessages: accounts.reduce((sum, a) => sum + (a.warmingStats?.messagesSent || 0) + (a.warmingStats?.messagesReceived || 0), 0),
    avgHealth: accounts.length > 0 
      ? Math.round(accounts.reduce((sum, a) => sum + (a.warmingStats?.healthScore || 0), 0) / accounts.length)
      : 0,
  };

  // Filter accounts
  const filteredAccounts = accounts.filter((a) => {
    if (poolViewMode === "all") return true;
    if (poolViewMode === "active") return a.pool === "active";
    if (poolViewMode === "idle") return a.pool === "idle";
    if (poolViewMode === "offline") return a.pool === "offline" || !a.pool;
    return true;
  });

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b bg-white dark:bg-slate-900 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 shadow-lg shadow-orange-500/25">
                  <Terminal className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-900 dark:text-white">
                    WhatsApp Warmer
                  </h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
                    {process.env.NODE_ENV === 'production' ? 'Production Mode - Cloud Hosted' : 'Development Mode - Local'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={connected ? "default" : "secondary"} className={cn(connected && "bg-emerald-500")}>
                  {connected ? "Connected" : "Offline"}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => { fetchAccounts(); fetchLogs(); }}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
              <TabsTrigger value="dashboard" className="gap-2">
                <LayoutDashboard className="h-4 w-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </TabsTrigger>
              <TabsTrigger value="accounts" className="gap-2">
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Akun</span>
              </TabsTrigger>
              <TabsTrigger value="chatlog" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Chat Log</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                <span className="hidden sm:inline">Settings</span>
              </TabsTrigger>
            </TabsList>

            {/* DASHBOARD TAB */}
            <TabsContent value="dashboard" className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                        <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Accounts</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                          {stats.onlineAccounts}<span className="text-sm text-slate-400">/{stats.totalAccounts}</span>
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-500/20">
                        <Flame className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Warming</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.warmingAccounts}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                        <Zap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Active Pool</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.activePool}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-500/20">
                        <Moon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Idle Pool</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.idlePool}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-500/20">
                        <MessageCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Messages</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.totalMessages}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-500/20">
                        <Activity className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Avg Health</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.avgHealth}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Activity & Actions */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Recent Activity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <div className="space-y-2">
                        {logs.slice(0, 20).map((log) => (
                          <div key={log.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <span className="text-slate-400 shrink-0 tabular-nums">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span className={cn("shrink-0", getLogColor(log.type))}>
                              <Activity className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-slate-600 dark:text-slate-300 flex-1 truncate">
                              {log.message}
                            </span>
                          </div>
                        ))}
                        {logs.length === 0 && (
                          <div className="text-center py-8 text-slate-500">
                            <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No activity yet</p>
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-3">
                      <Button onClick={() => setAddAccountOpen(true)} className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600">
                        <Plus className="h-4 w-4 mr-2" />
                        Add WhatsApp Account
                      </Button>
                      <Button onClick={handleRotatePools} variant="outline">
                        <RotateCw className="h-4 w-4 mr-2" />
                        Rotate Pools
                      </Button>
                      <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 mt-2">
                        <p className="text-xs text-slate-500 mb-2">Pool Status</p>
                        <div className="flex gap-4">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-sm">Active: {stats.activePool}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <span className="text-sm">Idle: {stats.idlePool}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Chat Pairs Section */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    Active Chat Pairs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {chatPairs.length === 0 ? (
                      <div className="col-span-full text-center py-8 text-slate-500">
                        <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No active chat pairs</p>
                      </div>
                    ) : (
                      chatPairs.slice(0, 6).map((pair) => (
                        <div key={pair.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1">
                              <span className="text-sm font-medium text-slate-900 dark:text-white">{pair.account1.name}</span>
                              <span className="text-slate-400">↔</span>
                              <span className="text-sm font-medium text-slate-900 dark:text-white">{pair.account2.name}</span>
                            </div>
                            <Badge variant="outline" className="text-[10px]">
                              {pair.messageCount} msg
                            </Badge>
                          </div>
                          <div className="text-xs text-slate-500 mb-2">
                            💬 "{pair.currentTopic}"
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className="text-[10px] bg-purple-500">
                              {pair.relationshipLabel}
                            </Badge>
                            {pair.sharedInterests.length > 0 && (
                              <Badge variant="outline" className="text-[10px] text-pink-600 border-pink-200">
                                ❤️ {pair.sharedInterests[0]}
                              </Badge>
                            )}
                            {/* Natural decay indicator */}
                            {pair.silenceCount > 0 && (
                              <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200">
                                🔇 {pair.silenceCount}/{pair.maxSilenceCount} silence
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ACCOUNTS TAB */}
            <TabsContent value="accounts" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Account Management</h2>
                  <p className="text-sm text-slate-500">{filteredAccounts.length} accounts</p>
                </div>
                <Button onClick={() => setAddAccountOpen(true)} className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Account
                </Button>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Pool:</span>
                <div className="flex gap-1">
                  {["all", "active", "idle", "offline"].map((pool) => (
                    <Button
                      key={pool}
                      size="sm"
                      variant={poolViewMode === pool ? "default" : "outline"}
                      className={cn("h-7 text-xs", poolViewMode === pool && pool === "active" && "bg-emerald-500 hover:bg-emerald-600", poolViewMode === pool && pool === "idle" && "bg-amber-500 hover:bg-amber-600")}
                      onClick={() => setPoolViewMode(pool as any)}
                    >
                      {pool === "all" ? "All" : pool.charAt(0).toUpperCase() + pool.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Account Grid */}
              {filteredAccounts.length === 0 ? (
                <Card>
                  <CardContent className="py-12">
                    <div className="flex flex-col items-center text-center">
                      <Users className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
                      <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">No Accounts</h3>
                      <p className="text-sm text-slate-500 mb-4">Add a WhatsApp account to start warming.</p>
                      <Button onClick={() => setAddAccountOpen(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Account
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredAccounts.map((account) => (
                    <Card
                      key={account.id}
                      className={cn(
                        "group relative overflow-hidden transition-all duration-200 hover:shadow-lg",
                        account.pool === "active" && account.status === 'online' && 'ring-2 ring-emerald-300 dark:ring-emerald-700',
                        account.pool === "idle" && account.status === 'online' && 'ring-2 ring-amber-300 dark:ring-amber-700'
                      )}
                    >
                      <div className={cn("h-1", getPoolColor(account.pool))} />

                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="relative">
                            <Avatar className="h-10 w-10 border-2 border-white dark:border-slate-700 shadow-sm">
                              <AvatarFallback className="bg-gradient-to-br from-orange-400 to-red-500 text-white font-semibold text-sm">
                                {account.personality?.name?.charAt(0) || account.id.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className={cn(
                              "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800",
                              getStatusColor(account.status)
                            )} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm text-slate-900 dark:text-white truncate">
                              {account.personality?.name || account.name || account.id}
                            </h3>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {account.personality 
                                ? `${account.personality.age}yo ${account.personality.occupation}`
                                : account.phoneNumber || "Not connected"}
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            {account.status === "online" ? (
                              <Wifi className="h-4 w-4 text-emerald-500" />
                            ) : account.status === "connecting" ? (
                              <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
                            ) : (
                              <WifiOff className="h-4 w-4 text-red-500" />
                            )}
                            
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setAccountDetail({ open: true, account })}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {/* Retry Connection - show for connecting or offline accounts */}
                                {(account.status === "connecting" || account.status === "offline") && (
                                  <DropdownMenuItem onClick={() => handleRetryConnection(account.id)}>
                                    <RotateCw className="h-4 w-4 mr-2" />
                                    Retry Connection
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => setDeleteAccountDialog({ open: true, account })}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Account
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>

                        {/* Pool Badge & Chronotype */}
                        {account.status === "online" && (
                          <div className="mb-2 flex items-center gap-2 flex-wrap">
                            <Badge className={cn("text-[10px]", account.pool === "active" ? "bg-emerald-500" : "bg-amber-500")}>
                              {account.pool === "active" ? "💬 Chatting" : "😴 Idle"}
                            </Badge>
                            {account.personality?.chronotype && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className={cn("text-[10px]", getChronotypeInfo(account.personality.chronotype).bg)}>
                                    {(() => {
                                      const info = getChronotypeInfo(account.personality.chronotype);
                                      const IconComponent = info.icon;
                                      return <IconComponent className={cn("h-3 w-3", info.color)} />;
                                    })()}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{getChronotypeInfo(account.personality.chronotype).label}</p>
                                  <p className="text-xs text-slate-400">
                                    {formatHour(account.personality.activeHoursStart || 0)} - {formatHour(account.personality.activeHoursEnd || 0)}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {account.isInActiveWindow === false && (
                              <Badge variant="secondary" className="text-[10px] bg-slate-200 dark:bg-slate-700">
                                🔴 Inactive
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* QR Code */}
                        {account.status === "connecting" && account.qrCode && (
                          <div 
                            className="flex flex-col items-center mb-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors group"
                            onClick={() => setQrModal({ open: true, qrCode: account.qrCode!, accountId: account.id })}
                          >
                            <img src={account.qrCode} alt="QR Code" className="w-32 h-32 rounded shadow-sm group-hover:scale-105 transition-transform" />
                            <p className="text-[10px] text-slate-400 mt-1 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                              Klik untuk memperbesar
                            </p>
                          </div>
                        )}

                        {/* Pairing Code */}
                        {account.status === "connecting" && account.pairingCode && (
                          <div className="flex flex-col items-center mb-3 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                            <p className="text-lg font-mono font-bold text-slate-900 dark:text-white">
                              {account.pairingCode}
                            </p>
                          </div>
                        )}

                        {/* Health Score */}
                        {account.status === "online" && account.warmingStats && (
                          <div className="mb-2">
                            <div className="flex items-center justify-between text-[10px] mb-1">
                              <span className="text-slate-500">Health</span>
                              <span className={cn("font-bold", getHealthColor(account.warmingStats.healthScore))}>
                                {account.warmingStats.healthScore}%
                              </span>
                            </div>
                            <Progress value={account.warmingStats.healthScore} className="h-1" />
                          </div>
                        )}

                        {/* Rate Limit */}
                        {account.rateLimit && (
                          <div className="flex items-center justify-between text-[10px] text-slate-500">
                            <span>Rate: {account.rateLimit.hour}/{account.rateLimit.maxHour}h</span>
                            <span>{account.rateLimit.day}/{account.rateLimit.maxDay}d</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Banned Accounts Section */}
              {bannedAccounts.length > 0 && (
                <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2 text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-5 w-5" />
                        Banned Accounts ({bannedAccounts.length})
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowBannedSection(!showBannedSection)}
                      >
                        {showBannedSection ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </CardHeader>
                  {showBannedSection && (
                    <CardContent>
                      <div className="space-y-3">
                        {bannedAccounts.map((banned) => (
                          <div
                            key={banned.id}
                            className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-lg border border-red-100 dark:border-red-900"
                          >
                            <div>
                              <p className="font-medium text-sm">{banned.id}</p>
                              <p className="text-xs text-slate-500">
                                Active: {banned.daysActive} days |
                                Sent: {banned.messagesSent} | Received: {banned.messagesReceived}
                              </p>
                              {banned.lastBanDate && (
                                <p className="text-xs text-red-500">
                                  Banned: {new Date(banned.lastBanDate).toLocaleString()}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => clearBannedStatus(banned.id)}
                                className="text-xs"
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Clear Ban
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resetPersonality(banned.id)}
                                className="text-xs text-amber-600"
                              >
                                <RotateCw className="h-3 w-3 mr-1" />
                                Reset
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}
            </TabsContent>

            {/* CHAT LOG TAB */}
            <TabsContent value="chatlog" className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Chat Log</h2>
                  <p className="text-sm text-slate-500">All message activity</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setLogs([])}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Messages</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[500px]">
                      {chatMessages.length > 0 ? (
                        <div className="space-y-3">
                          {chatMessages.map((msg) => (
                            <div key={msg.id} className={cn(
                              "flex gap-3 p-3 rounded-lg",
                              msg.direction === 'outgoing' 
                                ? "bg-slate-50 dark:bg-slate-800/50 ml-8"
                                : "bg-emerald-50 dark:bg-emerald-500/10 mr-8"
                            )}>
                              <div className={cn(
                                "p-2 rounded-full shrink-0",
                                msg.direction === 'outgoing' 
                                  ? "bg-orange-100 dark:bg-orange-500/20"
                                  : "bg-emerald-100 dark:bg-emerald-500/20"
                              )}>
                                {msg.direction === 'outgoing' ? (
                                  <ArrowUpRight className="h-4 w-4 text-orange-600" />
                                ) : (
                                  <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                    {msg.accountId}
                                  </span>
                                  {msg.isAutoResponse && (
                                    <Badge variant="secondary" className="text-[10px]">
                                      <Bot className="h-2.5 w-2.5 mr-1" />
                                      Auto
                                    </Badge>
                                  )}
                                  <span className="text-[10px] text-slate-400 ml-auto">
                                    {new Date(msg.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-sm text-slate-600 dark:text-slate-300 break-words">
                                  {msg.text}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full py-12">
                          <MessageCircle className="h-12 w-12 text-slate-300 dark:text-slate-600 mb-4" />
                          <p className="text-sm text-slate-500">No messages yet</p>
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Summary</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Inbox className="h-4 w-4 text-emerald-500" />
                            <span className="text-sm text-slate-600">Incoming</span>
                          </div>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {chatMessages.filter(m => m.direction === 'incoming').length}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <LogOut className="h-4 w-4 text-orange-500" />
                            <span className="text-sm text-slate-600">Outgoing</span>
                          </div>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {chatMessages.filter(m => m.direction === 'outgoing').length}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Bot className="h-4 w-4 text-purple-500" />
                            <span className="text-sm text-slate-600">Auto Replies</span>
                          </div>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {chatMessages.filter(m => m.isAutoResponse).length}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Activity Log</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-72">
                        <div className="space-y-1">
                          {logs.slice(0, 50).map((log) => (
                            <div key={log.id} className="flex items-start gap-2 text-xs py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <span className="text-slate-400 shrink-0 tabular-nums">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                              <span className={cn("shrink-0", getLogColor(log.type))}>
                                <Activity className="h-3.5 w-3.5" />
                              </span>
                              <span className="text-slate-600 dark:text-slate-300 flex-1 truncate">
                                {log.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            {/* SETTINGS TAB */}
            <TabsContent value="settings" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* AI API Settings */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Bot className="h-5 w-5 text-purple-500" />
                      AI API Settings
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-blue-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Groq API (Recommended)</p>
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            Groq offers FREE tier with generous limits. Get your API key at{' '}
                            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="underline">
                              console.groq.com/keys
                            </a>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="groqApiKey">Groq API Key</Label>
                      <Input
                        id="groqApiKey"
                        type="password"
                        placeholder="gsk_xxxxxxxxxxxxx"
                        value={aiSettings.groqApiKey}
                        onChange={(e) => setAiSettings({...aiSettings, groqApiKey: e.target.value})}
                      />
                      <p className="text-xs text-slate-500">
                        Get free API key at console.groq.com/keys
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="groqModel">Model</Label>
                      <Select value={aiSettings.groqModel} onValueChange={(v) => setAiSettings({...aiSettings, groqModel: v})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="llama-3.3-70b-versatile">Llama 3.3 70B (Recommended)</SelectItem>
                          <SelectItem value="llama-3.1-8b-instant">Llama 3.1 8B Instant (Fast)</SelectItem>
                          <SelectItem value="llama-3.2-3b-preview">Llama 3.2 3B (Fastest)</SelectItem>
                          <SelectItem value="mixtral-8x7b-32768">Mixtral 8x7B</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={saveAiSettings} disabled={isSavingSettings} className="flex-1">
                        {isSavingSettings ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 mr-2" />
                            Save Settings
                          </>
                        )}
                      </Button>
                      <Button variant="outline" onClick={testAiConnection} disabled={isTestingAi}>
                        {isTestingAi ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {aiTestResult && (
                      <div className={`p-3 rounded-lg ${aiTestResult.success ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                        <div className="flex items-start gap-2">
                          {aiTestResult.success ? (
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                          )}
                          <div>
                            <p className={`text-sm font-medium ${aiTestResult.success ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                              {aiTestResult.success ? 'Connection Successful!' : 'Connection Failed'}
                            </p>
                            {aiTestResult.response && (
                              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                                Response: {aiTestResult.response}
                              </p>
                            )}
                            {aiTestResult.error && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                {aiTestResult.error}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* AI Status Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-emerald-500" />
                      AI Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Provider</span>
                        <Badge variant={aiSettings.provider === 'groq' ? 'default' : 'secondary'}>
                          {aiSettings.provider.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <span className="text-sm text-slate-600 dark:text-slate-400">API Key Status</span>
                        <Badge variant={aiSettings.hasGroqKey ? 'default' : 'destructive'}>
                          {aiSettings.hasGroqKey ? '✓ Configured' : '✗ Not Set'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <span className="text-sm text-slate-600 dark:text-slate-400">Model</span>
                        <span className="text-sm font-medium">{aiSettings.groqModel}</span>
                      </div>
                      {aiSettings.lastUpdated && (
                        <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                          <span className="text-sm text-slate-600 dark:text-slate-400">Last Updated</span>
                          <span className="text-xs text-slate-500">{new Date(aiSettings.lastUpdated).toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Fallback Mode</p>
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            If AI fails, the system will use random responses from a predefined list.
                            This ensures accounts stay active even without API access.
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </main>

        {/* Add Account Dialog */}
        <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-orange-500" />
                Add WhatsApp Account
              </DialogTitle>
              <DialogDescription>Choose how to add accounts</DialogDescription>
            </DialogHeader>
            
            <Tabs value={addMode} onValueChange={(v) => setAddMode(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="single" className="text-xs">Single</TabsTrigger>
                <TabsTrigger value="bulk" className="text-xs">Bulk Queue</TabsTrigger>
                <TabsTrigger value="excel" className="text-xs">Excel Upload</TabsTrigger>
              </TabsList>
              
              {/* Single Account Mode */}
              <TabsContent value="single" className="space-y-4 py-4">
                <div>
                  <Label>Account ID</Label>
                  <Input placeholder="e.g., warmer-1" value={newAccountId} onChange={(e) => setNewAccountId(e.target.value)} className="mt-1.5" />
                </div>

                <div>
                  <Label>Authentication Method</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Button size="sm" variant={authMethod === "qr" ? "default" : "outline"} onClick={() => setAuthMethod("qr")} className="flex-1">
                      <QrCode className="h-4 w-4 mr-1" />
                      QR Code
                    </Button>
                    <Button size="sm" variant={authMethod === "pairing" ? "default" : "outline"} onClick={() => setAuthMethod("pairing")} className="flex-1">
                      <Hash className="h-4 w-4 mr-1" />
                      Pairing
                    </Button>
                  </div>
                </div>

                {authMethod === "pairing" && (
                  <div>
                    <Label>Phone Number</Label>
                    <Input placeholder="e.g., 6281234567890" value={newPhoneNumber} onChange={(e) => setNewPhoneNumber(e.target.value)} className="mt-1.5" />
                  </div>
                )}
              </TabsContent>
              
              {/* Bulk Queue Mode - Continuous QR/Pairing */}
              <TabsContent value="bulk" className="space-y-4 py-4">
                <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
                  <div className="flex items-start gap-3">
                    <Layers className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Continuous Mode</p>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        Accounts will be created one-by-one. After each scan/connection, a new QR/Pairing code appears automatically.
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Total Accounts</Label>
                    <Input 
                      type="number" 
                      placeholder="10" 
                      value={bulkCount} 
                      onChange={(e) => setBulkCount(e.target.value)} 
                      className="mt-1.5" 
                    />
                  </div>
                  <div>
                    <Label>Account Prefix</Label>
                    <Input 
                      placeholder="warmer" 
                      value={bulkPrefix} 
                      onChange={(e) => setBulkPrefix(e.target.value)} 
                      className="mt-1.5" 
                    />
                  </div>
                </div>
                
                <div>
                  <Label>Authentication Method</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Button size="sm" variant={authMethod === "qr" ? "default" : "outline"} onClick={() => setAuthMethod("qr")} className="flex-1">
                      <QrCode className="h-4 w-4 mr-1" />
                      QR Code
                    </Button>
                    <Button size="sm" variant={authMethod === "pairing" ? "default" : "outline"} onClick={() => setAuthMethod("pairing")} className="flex-1">
                      <Hash className="h-4 w-4 mr-1" />
                      Pairing
                    </Button>
                  </div>
                </div>
                
                {authMethod === "pairing" && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      ⚠️ Pairing mode requires phone numbers. Use Excel Upload for bulk pairing codes.
                    </p>
                  </div>
                )}
                
                {bulkCount && bulkPrefix && (
                  <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800">
                    <p className="text-xs text-slate-500 mb-2">Preview Account IDs:</p>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: Math.min(5, parseInt(bulkCount) || 0) }, (_, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {bulkPrefix}-{i + 1}
                        </Badge>
                      ))}
                      {(parseInt(bulkCount) || 0) > 5 && (
                        <Badge variant="outline" className="text-[10px] text-slate-400">
                          +{(parseInt(bulkCount) || 0) - 5} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>
              
              {/* Excel Upload Mode */}
              <TabsContent value="excel" className="space-y-4 py-4">
                <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
                  <div className="flex items-start gap-3">
                    <FileSpreadsheet className="h-5 w-5 text-emerald-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Excel Upload</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                        Upload Excel file with account data. Columns: account_id, phone (optional), method (qr/pairing)
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                    <Download className="h-4 w-4 mr-2" />
                    Download Template
                  </Button>
                  
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={handleExcelUpload}
                    />
                    <Button variant="default" size="sm" asChild>
                      <span>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Excel
                      </span>
                    </Button>
                  </label>
                </div>
                
                {/* Upload Result */}
                {excelUploadResult && (
                  <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm font-medium text-slate-900 dark:text-white">
                        {excelUploadResult.total} accounts parsed
                      </span>
                    </div>
                    <div className="max-h-32 overflow-y-auto">
                      <div className="flex flex-wrap gap-1">
                        {excelUploadResult.accounts?.slice(0, 10).map((acc: any, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            {acc.accountId}
                          </Badge>
                        ))}
                        {excelUploadResult.total > 10 && (
                          <Badge variant="outline" className="text-[10px] text-slate-400">
                            +{excelUploadResult.total - 10} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Bulk Queue Progress */}
                {bulkQueueStatus && bulkQueueStatus.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Queue Progress</span>
                      <span>{bulkQueueStatus.completed}/{bulkQueueStatus.total}</span>
                    </div>
                    <Progress value={(bulkQueueStatus.completed / bulkQueueStatus.total) * 100} className="h-2" />
                    <div className="flex gap-4 text-xs">
                      <span className="text-emerald-500">✓ {bulkQueueStatus.completed} done</span>
                      <span className="text-amber-500">⏳ {bulkQueueStatus.pending} pending</span>
                      {bulkQueueStatus.failed > 0 && (
                        <span className="text-red-500">✗ {bulkQueueStatus.failed} failed</span>
                      )}
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddAccountOpen(false)}>Cancel</Button>
              <Button 
                onClick={handleAddAccount} 
                className="bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : addMode === 'single' ? (
                  'Start Session'
                ) : addMode === 'bulk' ? (
                  <>
                    <Layers className="h-4 w-4 mr-2" />
                    Start Bulk Queue
                  </>
                ) : (
                  excelUploadResult ? 'Start Processing' : 'Upload First'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Account Confirmation */}
        <AlertDialog open={deleteAccountDialog.open} onOpenChange={(open) => setDeleteAccountDialog({ open, account: open ? deleteAccountDialog.account : null })}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Delete Account
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>{deleteAccountDialog.account?.personality?.name || deleteAccountDialog.account?.id}</strong>? 
                This will logout and remove all session data permanently.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteAccount} disabled={isDeleting} className="bg-red-500 hover:bg-red-600">
                {isDeleting ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>) : "Delete Account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Account Detail Dialog */}
        <Dialog open={accountDetail.open} onOpenChange={(open) => setAccountDetail({ open, account: open ? accountDetail.account : null })}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Account Details</DialogTitle>
            </DialogHeader>
            {accountDetail.account && (
              <div className="space-y-4 py-4">
                {/* Header */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16 border-2 border-white dark:border-slate-700 shadow-sm">
                    <AvatarFallback className="bg-gradient-to-br from-orange-400 to-red-500 text-white font-bold text-xl">
                      {accountDetail.account.personality?.name?.charAt(0) || accountDetail.account.id.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                      {accountDetail.account.personality?.name || accountDetail.account.name || accountDetail.account.id}
                    </h3>
                    <p className="text-sm text-slate-500">{accountDetail.account.phoneNumber || "Not connected"}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn("w-2 h-2 rounded-full", getStatusColor(accountDetail.account.status))} />
                      <span className="text-xs capitalize text-slate-600 dark:text-slate-400">{accountDetail.account.status}</span>
                      {accountDetail.account.pool && (
                        <Badge className={cn("ml-2 text-[10px]", getPoolColor(accountDetail.account.pool))}>
                          {accountDetail.account.pool}
                        </Badge>
                      )}
                      {accountDetail.account.isInActiveWindow !== undefined && (
                        <Badge variant={accountDetail.account.isInActiveWindow ? "default" : "secondary"} className="text-[10px]">
                          {accountDetail.account.isInActiveWindow ? '🟢 Active Window' : '🔴 Inactive'}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Full Personality Details */}
                {accountDetail.account.personality && (
                  <div className="space-y-4">
                    {/* Chronotype Badge */}
                    {accountDetail.account.personality.chronotype && (
                      <div className={cn("p-3 rounded-lg", getChronotypeInfo(accountDetail.account.personality.chronotype).bg)}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const info = getChronotypeInfo(accountDetail.account.personality.chronotype);
                              const IconComponent = info.icon;
                              return <IconComponent className={cn("h-5 w-5", info.color)} />;
                            })()}
                            <span className="font-medium text-slate-900 dark:text-white">
                              {getChronotypeInfo(accountDetail.account.personality.chronotype).label}
                            </span>
                          </div>
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {getChronotypeInfo(accountDetail.account.personality.chronotype).desc}
                          </span>
                        </div>
                        {/* Active Hours */}
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <Clock className="h-3.5 w-3.5" />
                          <span>
                            Active: {formatHour(accountDetail.account.personality.activeHoursStart || 0)} - {formatHour(accountDetail.account.personality.activeHoursEnd || 0)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Basic Info */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                          <User className="h-3.5 w-3.5" />
                          Age
                        </div>
                        <p className="font-medium text-slate-900 dark:text-white">{accountDetail.account.personality.age} years old</p>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                          <Briefcase className="h-3.5 w-3.5" />
                          Occupation
                        </div>
                        <p className="font-medium text-slate-900 dark:text-white">{accountDetail.account.personality.occupation}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 col-span-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                          <MapPin className="h-3.5 w-3.5" />
                          Location
                        </div>
                        <p className="font-medium text-slate-900 dark:text-white">{accountDetail.account.personality.location}</p>
                      </div>
                    </div>

                    {/* Traits */}
                    {accountDetail.account.personality.traits && accountDetail.account.personality.traits.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                          <Sparkles className="h-3.5 w-3.5" />
                          Traits (Sifat)
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {accountDetail.account.personality.traits.map((trait, i) => (
                            <Badge key={i} variant="outline" className="bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/30">
                              {trait}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hobbies */}
                    {accountDetail.account.personality.hobbies && accountDetail.account.personality.hobbies.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                          <Heart className="h-3.5 w-3.5" />
                          Hobbies
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {accountDetail.account.personality.hobbies.map((hobby, i) => (
                            <Badge key={i} variant="outline" className="bg-pink-50 dark:bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-500/30">
                              {hobby}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Communication Style */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <MessageCircle className="h-3.5 w-3.5" />
                        Communication Style
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-center">
                          <p className="text-[10px] text-slate-500 mb-1">Emoji</p>
                          <p className="text-xs font-medium text-slate-900 dark:text-white">
                            {getEmojiUsageLabel(accountDetail.account.personality.emojiUsage).label}
                          </p>
                          <p className="text-xs mt-1">
                            {getEmojiUsageLabel(accountDetail.account.personality.emojiUsage).emoji}
                          </p>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-center">
                          <p className="text-[10px] text-slate-500 mb-1">Msg Length</p>
                          <p className="text-xs font-medium text-slate-900 dark:text-white">
                            {getMessageLengthLabel(accountDetail.account.personality.avgMessageLength)}
                          </p>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 text-center">
                          <p className="text-[10px] text-slate-500 mb-1">Avg Response</p>
                          <p className="text-xs font-medium text-slate-900 dark:text-white">
                            {accountDetail.account.personality.avgResponseTime || '?'} min
                          </p>
                        </div>
                      </div>

                      {/* Writing Style */}
                      {accountDetail.account.personality.writingStyle && (
                        <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30">
                          <p className="text-[10px] text-purple-600 dark:text-purple-400 mb-1">Writing Style</p>
                          <p className="text-xs text-purple-700 dark:text-purple-300">{accountDetail.account.personality.writingStyle}</p>
                        </div>
                      )}

                      {/* Response Style */}
                      {accountDetail.account.personality.responseStyle && (
                        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30">
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 mb-1">Response Style</p>
                          <p className="text-xs text-blue-700 dark:text-blue-300">{accountDetail.account.personality.responseStyle}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <Separator />

                {/* Warming Statistics */}
                {accountDetail.account.warmingStats && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Warming Statistics
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-center">
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mb-1">Sent</p>
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{accountDetail.account.warmingStats.messagesSent}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-center">
                        <p className="text-[10px] text-blue-600 dark:text-blue-400 mb-1">Received</p>
                        <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{accountDetail.account.warmingStats.messagesReceived}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-center">
                        <p className="text-[10px] text-purple-600 dark:text-purple-400 mb-1">Auto Reply</p>
                        <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{accountDetail.account.warmingStats.autoResponsesSent}</p>
                      </div>
                    </div>
                    
                    {/* Health Score */}
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-500">Health Score</span>
                        <span className={cn("text-sm font-bold", getHealthColor(accountDetail.account.warmingStats.healthScore))}>
                          {accountDetail.account.warmingStats.healthScore}%
                        </span>
                      </div>
                      <Progress value={accountDetail.account.warmingStats.healthScore} className="h-2" />
                    </div>
                  </div>
                )}

                <Button variant="destructive" size="sm" className="w-full" onClick={() => {
                  setAccountDetail({ open: false, account: null });
                  setDeleteAccountDialog({ open: true, account: accountDetail.account });
                }}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Account
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* QR Code Enlarged Modal */}
        <Dialog open={qrModal.open} onOpenChange={(open) => {
          if (!open) setQrModal({ open: false, qrCode: "", accountId: "" });
        }}>
          <DialogContent className="sm:max-w-4xl max-h-[95vh] overflow-y-auto">
            <DialogHeader>
              <VisuallyHidden>
                <DialogTitle>Scan QR Code untuk {qrModal.accountId}</DialogTitle>
              </VisuallyHidden>
            </DialogHeader>
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6 py-2">
              {/* QR Code */}
              <div className="flex-shrink-0 flex items-center justify-center">
                {qrModal.qrCode ? (
                  <div className="p-3 sm:p-4 bg-white rounded-2xl shadow-lg">
                    <img 
                      src={qrModal.qrCode} 
                      alt="QR Code" 
                      className="w-56 h-56 sm:w-64 sm:h-64 lg:w-[400px] lg:h-[400px] rounded-xl"
                    />
                  </div>
                ) : (
                  <div className="w-56 h-56 sm:w-64 sm:h-64 lg:w-[400px] lg:h-[400px] flex items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-2xl">
                    <Loader2 className="h-10 w-10 sm:h-12 sm:w-12 animate-spin text-slate-400" />
                  </div>
                )}
              </div>
              
              {/* Info */}
              <div className="flex-1 text-center sm:text-left space-y-4 sm:space-y-5 sm:py-2">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white flex items-center justify-center sm:justify-start gap-2">
                    <QrCode className="h-5 w-5 text-orange-500" />
                    Scan QR Code
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Account: <span className="font-semibold text-orange-500">{qrModal.accountId}</span>
                  </p>
                </div>
                
                <div className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-800 rounded-xl">
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    📱 Buka WhatsApp → Menu → Perangkat Tertaut → Tautkan Perangkat
                  </p>
                </div>

                <div className="p-3 sm:p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl">
                  <p className="text-xs sm:text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
                    ⏱️ QR Code akan kadaluarsa dalam beberapa menit. Jika sudah kedaluwarsa, tutup dan buka kembali.
                  </p>
                </div>
                
                <Button 
                  variant="outline" 
                  className="w-full sm:w-auto px-8"
                  onClick={() => setQrModal({ open: false, qrCode: "", accountId: "" })}
                >
                  Tutup
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
