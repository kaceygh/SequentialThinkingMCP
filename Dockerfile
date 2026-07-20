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

# 复制 package 文件
COPY package*.json ./

# 安装生产环境依赖（包含 supergateway）
RUN npm ci --omit=dev && \
    npm install -g supergateway

# 从第一阶段（builder）中复制编译好的 dist 目录
COPY --from=builder /app/dist ./dist

# 复制启动脚本
COPY start.sh ./

# 暴露端口
EXPOSE 8000

# 启动命令
CMD ["sh", "./start.sh"]
