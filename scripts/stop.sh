#!/usr/bin/env bash
# Stop the local API cluster and stand-in Ginesys (the stand-in saves its state on exit).
for p in $(ps -eo pid,args | grep -E "node --import tsx src/(cluster|server)\.ts" | grep -v grep | awk '{print $1}'); do kill "$p" 2>/dev/null; done
sleep 1; echo stopped
