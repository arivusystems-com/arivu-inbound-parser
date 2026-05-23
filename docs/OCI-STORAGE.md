# OCI Object Storage setup

Arivu Inbound Parser stores **raw MIME** and **attachments** in OCI Object Storage using the [S3-compatible API](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).

MongoDB holds metadata only; binaries never go in MongoDB.

## 1. Create a bucket

1. OCI Console → **Storage** → **Buckets**
2. Create bucket e.g. `arivu-inbound`
3. Note your **namespace** (top of bucket details) and **region**

## 2. Customer Secret Keys

1. User profile → **Customer secret keys** → **Generate secret key**
2. Save **Access Key** and **Secret Key** immediately (secret shown once)

The **Access Key** is **not** your OCI login email.

The **Secret Key** is an Oracle-generated base64 string (~44 characters, often ending with `=`). It uses only `A–Z`, `a–z`, `0–9`, `+`, `/`, and `=`. If your secret is short or contains characters like `#`, `)`, or `]`, it is wrong or was truncated.

Put **both** values in `.env` — do not swap them:

```env
STORAGE_ACCESS_KEY="paste-access-key-here"
STORAGE_SECRET_KEY="paste-full-base64-secret-here"
```

Wrap values in **double quotes** if they contain `#` or spaces (otherwise `#` starts a comment and truncates the key).

## 3. Configure `.env`

```env
STORAGE_ENDPOINT=https://YOUR_NAMESPACE.compat.objectstorage.us-phoenix-1.oraclecloud.com
STORAGE_REGION=us-phoenix-1
STORAGE_ACCESS_KEY="ocid1.credential.oc1..aaaa..."
STORAGE_SECRET_KEY="your-secret-with-special-chars-quoted"
STORAGE_BUCKET=arivu-inbound
STORAGE_FORCE_PATH_STYLE=true
```

Replace `YOUR_NAMESPACE` and region with your tenancy values.

**Endpoint pattern:**

```text
https://<namespace>.compat.objectstorage.<region>.oraclecloud.com
```

## 4. Object layout

| Type | Path |
|------|------|
| Raw email | `raw/{tenantId}/{messageId}.eml` |
| Attachment | `attachments/{tenantId}/{attachmentId}` |

## 5. IAM (production)

Grant the user or dynamic group policies for the bucket, e.g.:

- `OBJECT_CREATE`
- `OBJECT_READ`
- `OBJECT_INSPECT`

Do not use overly broad tenancy-wide object admin in production.

## 6. Local development

Docker Compose starts **MongoDB + Redis + MailHog** only. Object storage is **OCI** via your `.env`.

Optional local MinIO (S3-compatible) if you cannot use OCI for dev:

```bash
docker compose --profile minio up -d
```

Then set:

```env
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_BUCKET=arivu-inbound
STORAGE_FORCE_PATH_STYLE=true
```

## 7. Verify

After `pnpm dev:core`, send a test email. In the admin UI **Message detail** page, confirm **Raw MIME (OCI)** shows a path like `raw/t_123/msg_....eml`.

In OCI Console → bucket → **Objects**, you should see the `.eml` file under `raw/`.
