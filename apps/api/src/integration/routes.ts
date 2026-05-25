import { Router } from 'express';
import type { Env } from '@arivu/config';
import type { DatabaseClient } from '@arivu/database';
import { seedTenantMailbox } from '@arivu/database';
import type { Logger } from '@arivu/logger';
import { buildRoutingAddress } from '@arivu/routing';
import { requireCrmApiKey } from './auth.js';
import { parseProvisionMailboxBody, parseProvisionTenantBody } from './validate.js';

export function createIntegrationRouter(
  config: Env,
  getDb: () => Promise<DatabaseClient>,
  log: Logger,
): Router {
  const router = Router();
  router.use(requireCrmApiKey(config));

  router.post('/tenants', async (req, res, next) => {
    try {
      const body = parseProvisionTenantBody(req.body);
      const db = await getDb();
      await db.tenants.updateOne(
        { _id: body.tenantId },
        { $set: { _id: body.tenantId, name: body.tenantName } },
        { upsert: true },
      );
      log.info({ tenantId: body.tenantId }, 'Tenant provisioned via CRM API');
      res.status(200).json({
        ok: true,
        tenantId: body.tenantId,
        tenantName: body.tenantName,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/mailboxes', async (req, res, next) => {
    try {
      const body = parseProvisionMailboxBody(req.body);
      const routingAddress = buildRoutingAddress(
        body.routingLocalPart,
        body.tenantId,
        body.mailboxId,
        config.SMTP_DOMAIN,
      );

      const db = await getDb();

      const existing = await db.mailboxes.findOne({ _id: body.mailboxId });
      if (existing && existing.tenantId !== body.tenantId) {
        res.status(409).json({
          error: 'mailboxId already registered to a different tenant',
          mailboxId: body.mailboxId,
          existingTenantId: existing.tenantId,
        });
        return;
      }

      const routingOwner = await db.mailboxes.findOne({ routingAddress });
      if (routingOwner && routingOwner._id !== body.mailboxId) {
        res.status(409).json({
          error: 'routingAddress already in use',
          routingAddress,
          existingMailboxId: routingOwner._id,
        });
        return;
      }

      await seedTenantMailbox(db, {
        tenantId: body.tenantId,
        tenantName: body.tenantName,
        mailboxId: body.mailboxId,
        mailboxName: body.mailboxName,
        routingAddress,
        mailboxType: body.mailboxType,
      });

      log.info(
        { tenantId: body.tenantId, mailboxId: body.mailboxId, routingAddress },
        'Mailbox provisioned via CRM API',
      );

      res.status(200).json({
        ok: true,
        tenantId: body.tenantId,
        tenantName: body.tenantName,
        mailboxId: body.mailboxId,
        mailboxName: body.mailboxName,
        mailboxType: body.mailboxType,
        routingAddress,
        forwardingHint: `Configure Gmail/M365 forwarding to: ${routingAddress}`,
      });
    } catch (err) {
      next(err);
    }
  });

  /** CRM fetch after email.received webhook (CRM_API_KEY — not admin UI session). */
  router.get('/messages/:messageId', async (req, res, next) => {
    try {
      const db = await getDb();
      const message = await db.messages.findOne({ _id: req.params.messageId });
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }
      res.json({ message });
    } catch (err) {
      next(err);
    }
  });

  router.get('/mailboxes/:mailboxId', async (req, res, next) => {
    try {
      const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
      if (!tenantId) {
        res.status(400).json({ error: 'tenantId query parameter is required' });
        return;
      }

      const db = await getDb();
      const mailbox = await db.mailboxes.findOne({
        _id: req.params.mailboxId,
        tenantId,
      });
      if (!mailbox) {
        res.status(404).json({ error: 'Mailbox not found' });
        return;
      }
      const tenant = await db.tenants.findOne({ _id: tenantId });
      res.json({ tenant, mailbox });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/mailboxes/:mailboxId', async (req, res, next) => {
    try {
      const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
      if (!tenantId) {
        res.status(400).json({ error: 'tenantId query parameter is required' });
        return;
      }

      const db = await getDb();
      const mailbox = await db.mailboxes.findOne({
        _id: req.params.mailboxId,
        tenantId,
      });
      if (!mailbox) {
        res.status(404).json({ error: 'Mailbox not found' });
        return;
      }

      const messageCount = await db.messages.countDocuments({
        tenantId,
        mailboxId: req.params.mailboxId,
      });
      if (messageCount > 0) {
        res.status(409).json({
          error: 'Mailbox has processed messages — disable in CRM instead of deleting',
          messageCount,
        });
        return;
      }

      await db.mailboxes.deleteOne({ _id: req.params.mailboxId, tenantId });
      log.info({ tenantId, mailboxId: req.params.mailboxId }, 'Mailbox removed via CRM API');
      res.json({ ok: true, mailboxId: req.params.mailboxId, tenantId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
