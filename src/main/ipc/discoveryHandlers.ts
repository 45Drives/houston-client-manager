import type { BrowserWindow } from 'electron';
import { checkSSH } from '../setupSsh';
import type { Server } from '../types';
import { loadSettings } from '../settingsStore';

export interface DiscoveryContext {
  discoveredServers: Server[];
  mainWindow: BrowserWindow;
  notify: (message: string) => void;
  mDNSClient: any;
  serviceType: string;
  TIMEOUT_DURATION: number;
  doFallbackScan: () => Promise<Server[]>;
  setDiscoveredServers: (servers: Server[]) => void;
}

export async function handleDiscoveryMessage(message: any, ctx: DiscoveryContext): Promise<boolean> {
  switch (message.type) {
    case 'addManualIP': {
      const { ip, manuallyAdded } = message as { ip: string; manuallyAdded?: boolean };

      let httpsReachable = false;
      try {
        const res = await fetch(`https://${ip}:9090/`, {
          method: 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        httpsReachable = res.ok;
      } catch (err) {
        console.warn('HTTPS check failed:', err);
      }

      let reachable = httpsReachable;
      if (!reachable) {
        reachable = await checkSSH(ip, 3000);
      }

      if (!reachable) {
        return (ctx.notify(`Error: Unable to reach ${ip} via HTTPS (9090) or SSH (22)`), true);
      }

      const server: Server = {
        ip,
        name: ip,
        status: 'unknown',
        setupComplete: false,
        lastSeen: Date.now(),
        serverName: ip,
        shareName: '',
        setupTime: '',
        serverInfo: { moboMake: '', moboModel: '', serverModel: '', aliasStyle: '', chassisSize: '' },
        manuallyAdded: manuallyAdded === true,
        fallbackAdded: false,
      };

      let existingServer = ctx.discoveredServers.find(eServer => eServer.ip === server.ip);

      try {
        if (!existingServer) {
          ctx.discoveredServers.push(server);
        } else {
          existingServer.lastSeen = Date.now();
          existingServer.status = server.status;
          existingServer.setupComplete = server.status === 'complete';
          existingServer.serverName = server.serverName;
          existingServer.shareName = server.shareName;
          existingServer.setupTime = server.setupTime;
          existingServer.serverInfo = server.serverInfo;
        }
      } catch (error) {
        console.error('Add Manual Server -> Fetch error:', error);
      }

      ctx.mainWindow.webContents.send('discovered-servers', ctx.discoveredServers);
      return true;
    }

    case 'rescanServers': {
      ctx.setDiscoveredServers([]);
      ctx.mainWindow.webContents.send('discovered-servers', ctx.discoveredServers);

      ctx.mDNSClient.query({ questions: [{ name: ctx.serviceType, type: 'PTR' }] });

      setTimeout(async () => {
        if (ctx.discoveredServers.length === 0 && loadSettings().discoveryFallbackEnabled) {
          const fallback = await ctx.doFallbackScan();
          if (fallback.length) {
            ctx.mainWindow.webContents.send('discovered-servers', fallback);
          }
        }
      }, ctx.TIMEOUT_DURATION);
      return true;
    }

    default:
      return false;
  }
}
