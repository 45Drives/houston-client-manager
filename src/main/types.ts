export interface Server {
  ip: string;
  name: string;
  lastSeen: number;
  status: string | "unknown";
  setupComplete?: boolean;
  shareName?: string;
  serverName?: string;
  setupTime?: string;
}
