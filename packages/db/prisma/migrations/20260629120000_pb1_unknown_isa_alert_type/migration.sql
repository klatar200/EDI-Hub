-- PB-1 F49 — distinct alert type for unknown ISA sender/receiver pairs.
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'UNKNOWN_ISA';
