# Security Checklist - Ready for Vercel

## ✅ Completed
- [x] `.gitignore` created - protects `.env`
- [x] Input validation on all endpoints
- [x] XSS protection (escapeHtml)
- [x] Signature verification on publish
- [x] CORS enabled
- [x] Request size limits (100kb)

## ⚠️ Before Deploy
1. Set environment variables in Vercel:
   - PRIVATE_KEY
   - PUBLIC_KEY
   - EXPLORER_TX_URL

2. Remove "type": "module" from package.json for Vercel compatibility

## 🚀 Deploy Command
```bash
vercel --prod
```
