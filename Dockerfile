FROM node:24-alpine AS build

WORKDIR /usr/src

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js ./

FROM scratch

# Node binary + runtime libraries
COPY --from=build /usr/local/bin/node /usr/bin/node
COPY --from=build /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=build /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=build /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=build /etc/os-release /etc/os-release

# Application
COPY --from=build /usr/src/node_modules /usr/src/node_modules
COPY --from=build /usr/src/index.js /usr/src/index.js
