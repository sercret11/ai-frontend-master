import type {
  SandboxFailureReport,
  SandboxRepairDispatchResponse,
  SandboxRepairStatusResponse,
  SandboxRepairTicket,
} from '@ai-frontend/shared-types';

interface SandboxRepairRecord {
  sessionId: string;
  report: SandboxFailureReport;
  ticket: SandboxRepairTicket;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isEnvironmentFailure(report: SandboxFailureReport): boolean {
  if (report.classification !== 'healthcheck') {
    return false;
  }

  const detail = `${report.summary} ${report.details ?? ''}`.toLowerCase();
  return detail.includes('sharedarraybuffer') || detail.includes('crossoriginisolated');
}

export class SandboxRepairService {
  private readonly records = new Map<string, SandboxRepairRecord>();

  public dispatchRepair(
    sessionId: string,
    report: SandboxFailureReport
  ): SandboxRepairDispatchResponse {
    const ticketId = createId('repair');
    const now = Date.now();
    const ticket: SandboxRepairTicket = {
      ticketId,
      reportId: report.reportId,
      status: 'queued',
      createdAt: now,
      assignee: 'agent',
      attempt: 1,
      maxAttempts: 3,
      summary: `queued repair for ${report.classification}`,
      metadata: {
        sessionId,
      },
    };

    const key = this.toKey(sessionId, ticketId);
    this.records.set(key, {
      sessionId,
      report,
      ticket,
    });

    this.scheduleStateTransitions(key);

    return {
      ok: true,
      ticket: { ...ticket },
      report: { ...report },
    };
  }

  public getRepairStatus(sessionId: string, ticketId: string): SandboxRepairStatusResponse | null {
    const record = this.records.get(this.toKey(sessionId, ticketId));
    if (!record) {
      return null;
    }

    return {
      ok: true,
      ticket: { ...record.ticket },
      report: { ...record.report },
    };
  }

  private scheduleStateTransitions(key: string): void {
    const queuedRecord = this.records.get(key);
    if (!queuedRecord) {
      return;
    }

    const now = Date.now();
    queuedRecord.ticket.status = 'dispatched';
    queuedRecord.ticket.dispatchedAt = now;
    queuedRecord.ticket.summary = `agent accepted failure report: ${queuedRecord.report.summary}`;

    setTimeout(() => {
      const record = this.records.get(key);
      if (!record || record.ticket.status !== 'dispatched') {
        return;
      }

      record.ticket.status = 'in_progress';
      record.ticket.summary = `agent is repairing: ${record.report.classification}`;
    }, 400);

    setTimeout(() => {
      const record = this.records.get(key);
      if (!record || record.ticket.status !== 'in_progress') {
        return;
      }

      if (isEnvironmentFailure(record.report)) {
        record.ticket.status = 'failed';
        record.ticket.completedAt = Date.now();
        record.ticket.summary = 'environment constraint detected; requires browser isolation support';
        return;
      }

      record.ticket.status = 'completed';
      record.ticket.completedAt = Date.now();
      record.ticket.summary = `repair plan generated for ${record.report.classification}`;
    }, 1100);
  }

  private toKey(sessionId: string, ticketId: string): string {
    return `${sessionId}:${ticketId}`;
  }
}

export const sandboxRepairService = new SandboxRepairService();
