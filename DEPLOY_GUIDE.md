# 🚀 Cloudflare Workers 部署指南

## 📋 部署前准备

### 1. 安装必要工具
```bash
# 安装Node.js (推荐v16+)
# 从 https://nodejs.org/ 下载安装

# 安装Wrangler CLI
npm install -g wrangler

# 登录Cloudflare
wrangler login
```

### 2. 准备数据文件
确保你有以下CSV文件：
- `jwdcx.csv` - 价位段投放标准数据
- `price.csv` - 商品价格表
- `input.csv` - 原始订单数据

## 🚀 快速部署步骤

### 方法1：一键部署（推荐）

1. **克隆项目**
```bash
git clone <your-repo-url>
cd cloudflare_tobacco
```

2. **安装依赖**
```bash
npm install
```

3. **配置Wrangler**
```bash
# 编辑wrangler.toml文件
# 修改name为你想要的域名前缀
```

4. **部署**
```bash
wrangler deploy
```

### 方法2：手动部署

1. **创建Workers项目**
```bash
wrangler init tobacco-data-analyzer
```

2. **复制文件**
将以下文件复制到项目目录：
- `src/index.js`
- `wrangler.toml`
- `package.json`

3. **部署**
```bash
wrangler deploy
```

## 🌐 访问应用

部署完成后，你会得到一个类似这样的URL：
```
https://tobacco-data-analyzer.your-subdomain.workers.dev
```

## 📁 项目结构

```
cloudflare_tobacco/
├── src/
│   └── index.js          # 主Workers脚本
├── wrangler.toml         # Cloudflare配置
├── package.json          # 项目配置
├── DEPLOY_GUIDE.md       # 本部署指南
└── README.md            # 使用说明
```

## 🔧 高级配置

### 自定义域名
1. 登录Cloudflare Dashboard
2. 进入Workers & Pages
3. 选择你的Workers项目
4. 添加自定义域名

### 环境变量
在`wrangler.toml`中添加：
```toml
[vars]
ENVIRONMENT = "production"
```

### 性能优化
```bash
# 启用缓存
wrangler kv:namespace create "CACHE"

# 在wrangler.toml中添加
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"
```

## 📊 使用示例

### 1. 上传数据
```javascript
// 通过API上传文件
const formData = new FormData();
formData.append('file', csvFile);
formData.append('type', 'jwdcx');

fetch('https://your-domain.workers.dev/api/upload', {
  method: 'POST',
  body: formData
});
```

### 2. 查询数据
```javascript
// 价位段查询
fetch('https://your-domain.workers.dev/api/query/segment', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    segment: '7段[263,290)',
    levels: ['27', '28', '29']
  })
});
```

## 🛠️ 故障排除

### 常见问题

1. **部署失败**
   - 检查wrangler是否已登录
   - 确认账户有Workers权限
   - 检查wrangler.toml配置

2. **文件上传失败**
   - 确认文件格式为CSV
   - 检查文件编码（UTF-8或GBK）
   - 文件大小限制（Workers免费版10MB）

3. **查询无结果**
   - 确认数据文件已正确上传
   - 检查档位和价位段参数

### 调试命令
```bash
# 本地测试
wrangler dev

# 查看日志
wrangler tail

# 检查配置
wrangler config list
```

## 🔄 更新部署

### 更新代码
```bash
# 修改代码后重新部署
wrangler deploy
```

### 回滚版本
```bash
wrangler rollback
```

## 📈 性能监控

### 查看分析
1. 登录Cloudflare Dashboard
2. 进入Workers & Pages
3. 查看性能指标和错误日志

### 设置警报
在Cloudflare Dashboard中设置Workers性能警报。

## 🎉 完成部署

部署成功后，你将拥有一个：
- ✅ **全球CDN加速**的在线应用
- ✅ **99.9%可用性**的云服务
- ✅ **自动扩展**的无服务器架构
- ✅ **免费SSL证书**的HTTPS访问
- ✅ **移动端优化**的响应式设计

## 📞 技术支持

如有问题：
1. 检查Cloudflare Workers文档
2. 查看wrangler日志
3. 联系Cloudflare支持

**恭喜！你的烟草数据分析系统已成功部署到Cloudflare Workers！** 🎊