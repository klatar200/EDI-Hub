/**
 * Desktop track D8 Sprint 2 — public server addressing for Clerk redirect setup.
 */
import { networkInterfaces } from 'node:os';
import type { HealthServerInfo } from '@edi/shared';

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
export function buildHealthServerInfo(port: number): HealthServerInfo {
  const origins = new Set<string>([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  for (const ip of lanIpv4Addresses()) {
    origins.add(`http://${ip}:${port}`);
  }
  return {
    port,
    redirectOrigins: [...origins].sort(),
  };
}
