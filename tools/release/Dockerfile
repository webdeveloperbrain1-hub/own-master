FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8787 CONTRACT_STORAGE_ROOT=/var/lib/ownmasters/storage
# Bootstrap HTTPS from Node's bundled Mozilla roots until Debian's CA package is installed.
RUN node -e "const fs=require('node:fs');fs.writeFileSync('/tmp/own-masters-ca.pem',require('node:tls').rootCertificates.join('\n'));const p='/etc/apt/sources.list.d/debian.sources';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('http://deb.debian.org','https://deb.debian.org'))" \
    && apt-get -o Acquire::https::CAInfo=/tmp/own-masters-ca.pem -o Acquire::https::Timeout=20 -o Acquire::Retries=1 update \
    && apt-get -o Acquire::https::CAInfo=/tmp/own-masters-ca.pem -o Acquire::https::Timeout=20 -o Acquire::Retries=1 install -y --no-install-recommends openssl ca-certificates libreoffice-writer fonts-liberation \
    && rm -rf /var/lib/apt/lists/* /tmp/own-masters-ca.pem \
    && mkdir -p /var/lib/ownmasters/storage && chown -R node:node /var/lib/ownmasters
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . .
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.API_PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/startProduction.mjs"]
