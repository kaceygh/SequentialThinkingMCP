#!/bin/sh

exec supergateway --stdio "node dist/index.js" --port 8000 --healthPath /health
