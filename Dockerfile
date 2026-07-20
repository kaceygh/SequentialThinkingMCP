# ==========================================
# 阶段 1：构建阶段 (Builder)
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖定义文件
COPY package*.json ./

# 在构建阶段安装所有依赖（包含 devDependencies，用于 TypeScript 编译）
RUN npm ci

# 复制源代码并编译
COPY . .
RUN npm run build


# ==========================================
# 阶段 2：生产运行阶段 (Runner)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境环境变量
ENV NODE_ENV=production

# 重新复制 package 文件以安装生产环境依赖
COPY package*.json ./

# 安装生产环境依赖
RUN npm ci --omit=dev

# 从第一阶段（builder）中只把编译好的 dist 目录复制过来
COPY --from=builder /app/dist ./dist

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# 启动命令
CMD ["node", "dist/index.js"]
