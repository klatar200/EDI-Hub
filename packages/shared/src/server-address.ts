/**
 * Desktop track D8 — LAN redirect origins for Clerk setup.
 */
import { networkInterfaces } from 'node:os';

function lanIpv4Addresses(): string[] {
  const nets = networkInterfaces();
  const out: string[] = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family !== 'IPv4' || net.internal) continue;
      out.push(net.address);
    }
  }
  return out;
}

/** Build redirect origins the admin should allow in Clerk for this hub instance. */
export function buildHealthServerInfo(port: number): {
  port: number;
  redirectOrigins: string[];
} {
  const origins = new Set<string>([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  for (const ip of lanIpv4Addresses()) {
    origins.add(`http://${ip}:${port}`);
  }
  return {
    port,
    redirectOrigins: [...origins].sort(),
  };
}
