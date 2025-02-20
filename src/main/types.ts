export interface Server {
  ip: string;
  name: string;
  lastSeen: number;
  status: string | "unknown";
}
