# Sandbox image for student code (plan §2.3).
#
# The API never runs student code in this image's default shell; it always supplies
# `/bin/sh /inputs/run.sh`, where /inputs is a read-only bind mount containing the
# submission's code.c and its test case inputs. Scratch files are written to /work.
#
# coreutils is required: the runner script uses GNU `timeout` semantics and
# `date +%s%N` for per-case timing.
FROM gcc:14-alpine

RUN apk add --no-cache coreutils bash \
 && adduser -D -u 1000 runner \
 && mkdir -p /work \
 && chown runner:runner /work

WORKDIR /work
USER runner

# No ENTRYPOINT/CMD on purpose: the orchestrator passes the command, so a broken
# invocation fails loudly instead of silently running an empty shell.
CMD ["/bin/false"]
