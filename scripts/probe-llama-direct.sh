#!/bin/bash
echo "--- direct llama.cpp chat completion, small prompt, timing ---"
time curl -s -m 100 http://127.0.0.1:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"Llama-3.2-3B-Instruct-Q4_K_M","max_tokens":40,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}' | head -c 400
echo
