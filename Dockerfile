# 使用Node.js v16.19.0作为基础镜像
FROM node:16.19.0-slim AS builder

# 设置工作目录
WORKDIR /home

# 复制源码
COPY . .

# 安装cloud189-sdk依赖
RUN cd vender/cloud189-sdk && \
    yarn install && \
    yarn build

# 安装项目依赖
RUN yarn install && \
    yarn build

# 构建生产版本
FROM node:16.19.0-alpine AS production

# 设置工作目录
WORKDIR /home

COPY --from=builder /home/package*.json ./
COPY --from=builder /home/yarn.lock ./

# 安装生产依赖
RUN yarn install --production

# 复制构建好的代码
COPY --from=builder /home/dist ./dist
COPY --from=builder /home/src/public ./dist/public
# 复制cloud189-sdk编译后的代码到./vender/cloud189-sdk/dist
COPY --from=builder /home/vender/cloud189-sdk/dist ./vender/cloud189-sdk/dist

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone
    
# 安装必要的依赖项
RUN apk update && \
    apk add --no-cache ca-certificates

# 创建数据目录
RUN mkdir -p /home/data

# 创建STRM目录
RUN mkdir -p /home/strm

# 挂载点
VOLUME ["/home/data", "/home/strm"]
# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["yarn", "start"]