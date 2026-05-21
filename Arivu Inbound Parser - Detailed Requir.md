# Arivu Inbound Parser — Detailed Requirements Document

## Project Overview

Arivu Inbound Parser is a scalable, multi-tenant inbound email processing engine designed for the Arivu CRM platform.

The system will receive emails forwarded from external mail providers such as:

* Gmail
* Outlook / Microsoft 365
* Yahoo
* Zoho
* Exchange
* Fastmail
* Proton Mail
* Custom SMTP providers

The parser will ingest emails over SMTP, store raw MIME safely, process and parse email content asynchronously, extract attachments, resolve tenant and mailbox routing, and emit structured events to downstream CRM systems.

The architecture must be production-grade, queue-driven, cloud-native, and designed for SaaS-scale multi-tenant operation.

---

# Goals

The system must:

* Receive inbound emails over SMTP
* Support multi-tenant routing
* Support private mailboxes
* Support shared mailboxes
* Parse MIME emails reliably
* Store immutable raw email
* Extract attachments and inline images
* Resolve email conversations and threads
* Support asynchronous processing
* Scale horizontally
* Be provider-agnostic
* Emit structured events to CRM services
* Be resilient against malformed emails
* Support future extensibility

---

# High-Level Architecture

```text
External Mail Providers
        ↓
SMTP Receiver
        ↓
Raw MIME Storage
        ↓
Queue System
        ↓
Parser Worker
        ↓
Tenant Resolver
        ↓
Thread Resolver
        ↓
Attachment Processor
        ↓
Event Dispatcher
        ↓
CRM / Downstream Systems
```

---

# Core Principles

## 1. Raw MIME First

Every email MUST be stored as immutable raw MIME before parsing.

Reasons:

* replay capability
* audit safety
* debugging support
* parser reliability

The raw MIME email is the source of truth.

---

## 2. Queue-Driven Architecture

SMTP reception MUST NOT perform heavy processing synchronously.

SMTP responsibilities:

* validate recipient
* generate internal message ID
* store raw MIME
* enqueue processing job
* acknowledge SMTP transaction

All heavy processing must happen asynchronously.

---

## 3. Multi-Tenant Isolation

Every email must belong to:

* a tenant
* a mailbox
* optionally a thread/conversation

Tenant boundaries must remain isolated.

---

# Supported Email Providers

The parser must support emails forwarded from:

* Gmail
* Google Workspace
* Outlook
* Microsoft 365
* Yahoo Mail
* Zoho Mail
* Proton Mail
* Fastmail
* Exchange
* cPanel mail
* Custom SMTP providers

Support is achieved through SMTP + MIME standards.

---

# SMTP Receiver Requirements

## Responsibilities

The SMTP layer must:

* accept inbound SMTP connections
* validate recipient addresses
* stream raw emails safely
* support large attachments
* prevent memory overuse
* generate internal message IDs
* store raw MIME
* enqueue jobs
* return SMTP success/failure responses

---

## Recommended Stack

* Node.js
* TypeScript
* smtp-server

---

## SMTP Features

### Must Support

* SMTP
* STARTTLS
* multiple recipients
* large message streaming
* MIME passthrough

### Future Extensions

* SMTPS
* rate limiting
* greylisting
* IP reputation
* DKIM signing

---

# Routing Address Format

The system must support plus-address routing.

Example:

```text
support+t_123_m_45@reply.arivusystems.com
```

Where:

* `t_123` = tenant ID
* `m_45` = mailbox ID

The parser must extract routing metadata from recipient addresses.

---

# Internal Message Model

Every inbound email must generate an internal message object.

Suggested structure:

```json
{
  "_id": "msg_01JXXXX",
  "tenantId": "t_123",
  "mailboxId": "m_45",
  "direction": "inbound",
  "messageId": "<external-message-id>",
  "subject": "Issue with invoice",
  "from": {},
  "to": [],
  "cc": [],
  "bcc": [],
  "replyTo": [],
  "headers": {},
  "htmlBody": "",
  "textBody": "",
  "attachments": [],
  "rawMimePath": "",
  "threadId": "",
  "receivedAt": ""
}
```

---

# MongoDB Design

Use MongoDB as the primary metadata database.

MongoDB is preferred because:

* email payloads are document-oriented
* MIME structures are nested
* headers are dynamic
* attachment metadata varies
* schema flexibility improves parser evolution

---

# Recommended Collections

## tenants

```json
{
  "_id": "t_123",
  "name": "Acme Inc"
}
```

## mailboxes

```json
{
  "_id": "m_45",
  "tenantId": "t_123",
  "type": "shared",
  "name": "Support",
  "routingAddress": "support+t_123_m_45@reply.arivusystems.com"
}
```

## messages

```json
{
  "_id": "msg_01JXXXX",
  "tenantId": "t_123",
  "mailboxId": "m_45",
  "messageId": "<external-id>",
  "threadId": "thr_001",
  "subject": "",
  "from": {},
  "to": [],
  "headers": {},
  "rawMimePath": "",
  "attachments": [],
  "processingStatus": "processed"
}
```

## threads

```json
{
  "_id": "thr_001",
  "tenantId": "t_123",
  "subject": "",
  "participants": [],
  "lastMessageAt": ""
}
```

## attachments

```json
{
  "_id": "att_001",
  "tenantId": "t_123",
  "messageId": "msg_01JXXXX",
  "filename": "invoice.pdf",
  "mimeType": "application/pdf",
  "storagePath": ""
}
```

---

# Important MongoDB Indexes

## messages

```text
tenantId
mailboxId
messageId
threadId
receivedAt
```

## threads

```text
tenantId
lastMessageAt
```

---

# Raw MIME Storage Requirements

Raw emails must:

* be immutable
* support replay
* support debugging
* support audit safety

## Recommended Storage Structure

```text
/raw/{tenantId}/{messageId}.eml
```

## Recommended Backend

Use OCI Object Storage for:

* raw MIME files
* attachments
* inline images

Do NOT store large binary content in MongoDB.

MongoDB should only store metadata and references.

---

# Queue System Requirements

## Responsibilities

Queue system handles:

* parser jobs
* attachment processing
* retries
* delayed processing
* dead-letter recovery

## Recommended Stack

* Redis
* BullMQ

## Suggested Queues

```text
smtp-ingest
mime-parse
attachment-process
event-dispatch
dead-letter
```

---

# MIME Parsing Requirements

## Parser Responsibilities

The parser must extract:

* headers
* subject
* sender
* recipients
* HTML body
* text body
* attachments
* inline images
* threading headers

## Recommended Stack

* mailparser

## MIME Types to Support

* text/plain
* text/html
* multipart/alternative
* multipart/mixed
* multipart/related
* nested multipart

---

# Attachment Processing Requirements

## Must Support

* multiple attachments
* inline images
* binary attachments
* large files

## Extracted Metadata

* filename
* MIME type
* extension
* size
* content disposition
* content ID

## Storage Structure

```text
/attachments/{tenantId}/{attachmentId}
```

---

# Thread Resolution Requirements

## Threading Headers

Must support:

* Message-ID
* In-Reply-To
* References

## Thread Resolution Priority

Priority order:

1. Custom outbound correlation headers
2. In-Reply-To
3. References
4. Subject fallback

Subject-only threading should be avoided whenever possible.

---

# Outbound Correlation Headers

The system must support future outbound headers:

```text
X-Arivu-Tenant
X-Arivu-Mailbox
X-Arivu-Thread
X-Arivu-Message
```

These headers improve inbound reply correlation.

---

# Event Dispatching

After successful processing, parser emits structured events.

Example:

```json
{
  "event": "email.received",
  "tenantId": "t_123",
  "mailboxId": "m_45",
  "messageId": "msg_01JXXXX"
}
```

---

# Failure Handling

## Parser Failures

Failures must:

* never lose raw email
* support retries
* support replay
* move to dead-letter queue when required

## Dead Letter Queue

Malformed or failed emails must remain recoverable.

---

# Security Requirements

## Initial Security

Must support:

* attachment size limits
* MIME validation
* recipient validation
* safe streaming
* tenant isolation

## Future Security Extensions

Planned:

* SPF validation
* DKIM verification
* DMARC
* antivirus scanning
* spam scoring
* rate limiting

---

# Performance Requirements

System must:

* support concurrent SMTP connections
* support large attachments
* avoid loading full emails into memory
* process emails asynchronously
* scale horizontally

---

# Scalability Requirements

Architecture must support:

* multiple workers
* multiple SMTP nodes
* distributed queues
* stateless services

---

# Logging Requirements

Must log:

* SMTP events
* parsing failures
* queue failures
* attachment failures
* routing failures

---

# Observability Requirements

Future support:

* metrics
* tracing
* dashboards
* queue monitoring

---

# Suggested Folder Structure

```text
apps/
 ├── smtp-server
 ├── parser-worker
 ├── attachment-worker
 └── api

packages/
 ├── database
 ├── storage
 ├── events
 ├── logger
 ├── config
 └── types
```

---

# Recommended Tech Stack

| Layer          | Recommendation     |
| -------------- | ------------------ |
| Runtime        | Node.js            |
| Language       | TypeScript         |
| SMTP Server    | smtp-server        |
| MIME Parser    | mailparser         |
| Queue          | BullMQ             |
| Cache          | Redis              |
| Database       | MongoDB            |
| Object Storage | OCI Object Storage |
| Validation     | Zod                |
| Logging        | Pino               |

---

# Development Phases

## Phase 1 — Core Infrastructure

* SMTP receiver
* raw MIME storage
* queue integration
* MIME parser
* tenant resolution

## Phase 2 — Attachments + Threading

* attachment extraction
* inline images
* thread resolution
* event dispatching

## Phase 3 — Reliability + Scaling

* retries
* dead-letter queues
* monitoring
* observability
* performance optimization

---

# Deliverables

Implementation must include:

* SMTP ingestion service
* MIME parser service
* queue workers
* storage abstraction
* routing engine
* thread engine
* attachment processor
* event dispatcher
* configuration system
* Docker support
* TypeScript support
* linting and formatting
* environment configuration

---

# Final Notes

The system must be designed as infrastructure-grade software.

Key priorities:

1. Reliability
2. Scalability
3. Multi-tenant isolation
4. Async processing
5. Immutable raw email storage
6. Provider-agnostic email ingestion
7. Future extensibility

The parser should become the foundational email ingestion layer for the entire Arivu CRM ecosystem.
