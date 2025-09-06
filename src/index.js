// 烟草数据在线分析系统 - Cloudflare Workers版本

// 工具函数
class DataProcessor {
    static parseCSV(text) {
        const lines = text.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            data.push(row);
        }
        return data;
    }

    static parseJwdcxData(text) {
        const lines = text.split('\n');
        const allData = [];
        let segmentName = null;
        let segmentLines = [];

        for (const line of lines) {
            const strippedLine = line.trim();
            if (!strippedLine) continue;
            
            if (strippedLine.startsWith('"价位段：')) {
                if (segmentName && segmentLines.length > 0) {
                    allData.push(...this.parseSegmentToTidyData(segmentName, segmentLines));
                }
                segmentName = strippedLine.split(',')[0].replace(/"/g, '').replace('按价位段投放情况如下(单位:条)', '').trim();
                segmentLines = [];
            } else if (segmentName) {
                segmentLines.push(line);
            }
        }
        
        if (segmentName && segmentLines.length > 0) {
            allData.push(...this.parseSegmentToTidyData(segmentName, segmentLines));
        }

        return allData.map(item => ({
            ...item,
            可定量: parseFloat(item.可定量) || 0,
            上限: parseFloat(item.上限) || 0
        })).filter(item => item.可定量 > 0);
    }

    static parseSegmentToTidyData(segmentName, lines) {
        let headerFound = false;
        let startIndex = 0;
        
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('序号,卷烟编码,卷烟名称')) {
                headerFound = true;
                startIndex = i;
                break;
            }
        }
        
        if (!headerFound) return [];
        
        const relevantLines = lines.slice(startIndex);
        const csvText = relevantLines.join('\n');
        const rows = this.parseCSV(csvText);
        
        const limitRow = rows.find(row => row['卷烟编码'] === '价位段上限');
        const products = rows.filter(row => row['卷烟编码'] !== '价位段上限');
        
        if (!limitRow) return [];
        
        const tidyRows = [];
        const dataColumns = Object.keys(products[0] || {}).filter(key => 
            !['序号', '卷烟编码', '卷烟名称'].includes(key)
        );
        
        for (const product of products) {
            const productName = product['卷烟名称'];
            for (const level of dataColumns) {
                const quantity = parseFloat(product[level]) || 0;
                const limit = parseFloat(limitRow[level]) || 0;
                
                tidyRows.push({
                    价位段: segmentName,
                    档位: level,
                    商品: productName,
                    上限: limit,
                    可定量: quantity
                });
            }
        }
        
        return tidyRows;
    }

    static parsePriceData(text) {
        const data = this.parseCSV(text);
        return data.map(item => ({
            规格名称: item['规格名称'] || item['规格'],
            批发价: parseFloat(item['批发价']) || 0
        }));
    }

    static parseInputData(text, priceData) {
        const data = this.parseCSV(text);
        const priceMap = new Map(priceData.map(item => [item.规格名称, item.批发价]));
        
        const records = [];
        const pattern = /(\d+)(?:档)?(?:[-~～](\d+)(?:档)?)?\s*[:：]?\s*([\d.]+)\s*条/g;
        
        for (const row of data) {
            const rule = (row['策略标准'] || '').toString();
            const spec = (row['规格名称'] || row['规格'] || '').toString();
            
            let match;
            while ((match = pattern.exec(rule)) !== null) {
                const start = parseInt(match[1]);
                const end = match[2] ? parseInt(match[2]) : start;
                const qty = parseFloat(match[3]);
                
                for (let grade = start; grade <= end; grade++) {
                    records.push({
                        档位: grade,
                        规格名称: spec,
                        条数: qty,
                        批发价: priceMap.get(spec) || 0,
                        金额: qty * (priceMap.get(spec) || 0)
                    });
                }
            }
        }
        
        return records;
    }

    static queryBySegment(data, segment, levels) {
        let filtered = data;
        
        if (segment !== '所有价位段') {
            filtered = filtered.filter(item => item.价位段 === segment);
        }
        
        if (levels && levels.length > 0) {
            filtered = filtered.filter(item => levels.includes(item.档位.toString()));
        }
        
        // 按商品聚合
        const aggregated = {};
        for (const item of filtered) {
            const key = item.商品;
            if (!aggregated[key]) {
                aggregated[key] = {
                    商品: key,
                    可定量: 0,
                    上限: item.上限 || 0,
                    价位段: item.价位段
                };
            }
            aggregated[key].可定量 += item.可定量;
        }
        
        return Object.values(aggregated).sort((a, b) => b.可定量 - a.可定量);
    }

    static compareSegments(data, segment1, segment2, levels) {
        let filtered1 = data;
        let filtered2 = data;
        
        if (segment1 !== '所有价位段') {
            filtered1 = filtered1.filter(item => item.价位段 === segment1);
        }
        if (segment2 !== '所有价位段') {
            filtered2 = filtered2.filter(item => item.价位段 === segment2);
        }
        
        if (levels && levels.length > 0) {
            filtered1 = filtered1.filter(item => levels.includes(item.档位.toString()));
            filtered2 = filtered2.filter(item => levels.includes(item.档位.toString()));
        }
        
        // 按商品和档位聚合
        const agg1 = {};
        const agg2 = {};
        
        for (const item of filtered1) {
            const key = `${item.商品}_${item.档位}`;
            if (!agg1[key]) {
                agg1[key] = { 商品: item.商品, 档位: item.档位, 可定量: 0, 上限: item.上限 || 0 };
            }
            agg1[key].可定量 += item.可定量;
        }
        
        for (const item of filtered2) {
            const key = `${item.商品}_${item.档位}`;
            if (!agg2[key]) {
                agg2[key] = { 商品: item.商品, 档位: item.档位, 可定量: 0, 上限: item.上限 || 0 };
            }
            agg2[key].可定量 += item.可定量;
        }
        
        // 合并对比
        const allKeys = new Set([...Object.keys(agg1), ...Object.keys(agg2)]);
        const result = [];
        
        for (const key of allKeys) {
            const item1 = agg1[key] || { 可定量: 0, 上限: 0 };
            const item2 = agg2[key] || { 可定量: 0, 上限: 0 };
            
            result.push({
                商品: item1.商品 || item2.商品,
                档位: item1.档位 || item2.档位,
                可定量_1: item1.可定量,
                可定量_2: item2.可定量,
                可定量差异: item1.可定量 - item2.可定量,
                上限_1: item1.上限,
                上限_2: item2.上限,
                上限差异: item1.上限 - item2.上限
            });
        }
        
        return result.sort((a, b) => Math.abs(b.可定量差异) - Math.abs(a.可定量差异));
    }

    static queryByGrade(data, grade) {
        return data.filter(item => item.档位 === parseInt(grade));
    }

    static compareGrades(data, grade1, grade2) {
        const filtered1 = data.filter(item => item.档位 === parseInt(grade1));
        const filtered2 = data.filter(item => item.档位 === parseInt(grade2));
        
        const agg1 = {};
        const agg2 = {};
        
        for (const item of filtered1) {
            if (!agg1[item.规格名称]) {
                agg1[item.规格名称] = { 规格名称: item.规格名称, 条数: 0, 批发价: item.批发价, 金额: 0 };
            }
            agg1[item.规格名称].条数 += item.条数;
            agg1[item.规格名称].金额 += item.金额;
        }
        
        for (const item of filtered2) {
            if (!agg2[item.规格名称]) {
                agg2[item.规格名称] = { 规格名称: item.规格名称, 条数: 0, 批发价: item.批发价, 金额: 0 };
            }
            agg2[item.规格名称].条数 += item.条数;
            agg2[item.规格名称].金额 += item.金额;
        }
        
        const allSpecs = new Set([...Object.keys(agg1), ...Object.keys(agg2)]);
        const result = [];
        
        for (const spec of allSpecs) {
            const item1 = agg1[spec] || { 条数: 0, 金额: 0 };
            const item2 = agg2[spec] || { 条数: 0, 金额: 0 };
            
            result.push({
                规格名称: spec,
                [`条数_${grade1}`]: item1.条数,
                [`条数_${grade2}`]: item2.条数,
                差异: item1.条数 - item2.条数,
                [`金额_${grade1}`]: item1.金额,
                [`金额_${grade2}`]: item2.金额,
                金额差异: item1.金额 - item2.金额
            });
        }
        
        return result.sort((a, b) => Math.abs(b.差异) - Math.abs(a.差异));
    }
}

// 全局数据存储
let jwdcxData = [];
let priceData = [];
let inputData = [];

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // API路由
        if (path.startsWith('/api/')) {
            if (path === '/api/upload' && method === 'POST') {
                return await handleUpload(request, corsHeaders);
            }
            if (path === '/api/segments' && method === 'GET') {
                return handleSegments(corsHeaders);
            }
            if (path === '/api/query/segment' && method === 'POST') {
                return await handleQuerySegment(request, corsHeaders);
            }
            if (path === '/api/query/grade' && method === 'POST') {
                return await handleQueryGrade(request, corsHeaders);
            }
            if (path === '/api/compare/segments' && method === 'POST') {
                return await handleCompareSegments(request, corsHeaders);
            }
            if (path === '/api/compare/grades' && method === 'POST') {
                return await handleCompareGrades(request, corsHeaders);
            }
        }

        // 静态文件服务
        if (path === '/' || path === '/index.html') {
            return new Response(getHTML(), {
                headers: { 'Content-Type': 'text/html;charset=UTF-8', ...corsHeaders }
            });
        }

        // 返回404
        return new Response('Not Found', { status: 404, headers: corsHeaders });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}

async function handleUpload(request, corsHeaders) {
    const formData = await request.formData();
    const file = formData.get('file');
    const type = formData.get('type');
    
    if (!file) {
        return new Response(JSON.stringify({ error: '没有文件' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    const text = await file.text();
    
    try {
        if (type === 'jwdcx') {
            jwdcxData = DataProcessor.parseJwdcxData(text);
            const segments = [...new Set(jwdcxData.map(item => item.价位段))];
            return new Response(JSON.stringify({ 
                message: '价位段数据上传成功', 
                segments: ['所有价位段', ...segments] 
            }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        } else if (type === 'price') {
            priceData = DataProcessor.parsePriceData(text);
            return new Response(JSON.stringify({ message: '价格数据上传成功' }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        } else if (type === 'input') {
            inputData = DataProcessor.parseInputData(text, priceData);
            return new Response(JSON.stringify({ message: '原始数据上传成功' }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}

function handleSegments(corsHeaders) {
    const segments = [...new Set(jwdcxData.map(item => item.价位段))];
    return new Response(JSON.stringify({ segments: ['所有价位段', ...segments] }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

async function handleQuerySegment(request, corsHeaders) {
    const body = await request.json();
    const { segment, levels } = body;
    
    if (jwdcxData.length === 0) {
        return new Response(JSON.stringify({ error: '请先上传价位段数据' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    const result = DataProcessor.queryBySegment(jwdcxData, segment, levels || []);
    return new Response(JSON.stringify({ data: result }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

async function handleQueryGrade(request, corsHeaders) {
    const body = await request.json();
    const { grade } = body;
    
    if (inputData.length === 0) {
        return new Response(JSON.stringify({ error: '请先上传原始订单数据' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    const result = DataProcessor.queryByGrade(inputData, grade);
    return new Response(JSON.stringify({ data: result }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

async function handleCompareSegments(request, corsHeaders) {
    const body = await request.json();
    const { segment1, segment2, levels } = body;
    
    if (jwdcxData.length === 0) {
        return new Response(JSON.stringify({ error: '请先上传价位段数据' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    const result = DataProcessor.compareSegments(jwdcxData, segment1, segment2, levels || []);
    return new Response(JSON.stringify({ data: result }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

async function handleCompareGrades(request, corsHeaders) {
    const body = await request.json();
    const { grade1, grade2 } = body;
    
    if (inputData.length === 0) {
        return new Response(JSON.stringify({ error: '请先上传原始订单数据' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    const result = DataProcessor.compareGrades(inputData, grade1, grade2);
    return new Response(JSON.stringify({ data: result }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}

function getHTML() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>烟草数据在线分析系统 - Cloudflare Workers</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa; }
        .upload-zone { border: 2px dashed #dee2e6; border-radius: 10px; padding: 30px; text-align: center; transition: all 0.3s ease; background-color: #ffffff; }
        .upload-zone:hover { border-color: #0d6efd; background-color: #f8f9ff; }
        .card { border: none; box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075); transition: box-shadow 0.3s ease; }
        .card:hover { box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15); }
        .positive-diff { color: #198754; font-weight: bold; }
        .negative-diff { color: #dc3545; font-weight: bold; }
        .loading { display: none; }
    </style>
</head>
<body>
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
        <div class="container">
            <a class="navbar-brand" href="#">
                <i class="fas fa-chart-bar me-2"></i>
                烟草数据在线分析系统 (Cloudflare Workers)
            </a>
        </div>
    </nav>

    <div class="container-fluid py-4">
        <!-- 文件上传区域 -->
        <div class="row mb-4">
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">
                            <i class="fas fa-upload me-2"></i>数据文件上传
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-4">
                                <div class="upload-zone">
                                    <i class="fas fa-file-csv fa-3x text-primary mb-3"></i>
                                    <h6>价位段数据 (jwdcx.csv)</h6>
                                    <input type="file" class="form-control" accept=".csv" id="jwdcx-file" onchange="uploadFile(this, 'jwdcx')">
                                    <div class="upload-status mt-2" id="jwdcx-status"></div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="upload-zone">
                                    <i class="fas fa-tags fa-3x text-success mb-3"></i>
                                    <h6>价格数据 (price.csv)</h6>
                                    <input type="file" class="form-control" accept=".csv" id="price-file" onchange="uploadFile(this, 'price')">
                                    <div class="upload-status mt-2" id="price-status"></div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="upload-zone">
                                    <i class="fas fa-table fa-3x text-info mb-3"></i>
                                    <h6>原始订单数据 (input.csv)</h6>
                                    <input type="file" class="form-control" accept=".csv" id="input-file" onchange="uploadFile(this, 'input')">
                                    <div class="upload-status mt-2" id="input-status"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 查询区域 -->
        <div class="row">
            <div class="col-lg-6 mb-4">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">
                            <i class="fas fa-search me-2"></i>价位段查询
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <label class="form-label">选择价位段</label>
                            <select class="form-select" id="segment-select">
                                <option value="所有价位段">所有价位段</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">输入档位（多个用逗号分隔）</label>
                            <input type="text" class="form-control" id="segment-levels" placeholder="例如: 27,28,29">
                        </div>
                        <button class="btn btn-primary" onclick="querySegment()">
                            <i class="fas fa-search me-1"></i>查询
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="col-lg-6 mb-4">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">
                            <i class="fas fa-balance-scale me-2"></i>档位查询
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <label class="form-label">输入档位</label>
                            <input type="number" class="form-control" id="grade-input" placeholder="例如: 27">
                        </div>
                        <button class="btn btn-success" onclick="queryGrade()">
                            <i class="fas fa-search me-1"></i>查询
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 对比区域 -->
        <div class="row">
            <div class="col-lg-6 mb-4">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">
                            <i class="fas fa-balance-scale me-2"></i>价位段对比
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-6">
                                <label class="form-label">价位段1</label>
                                <select class="form-select" id="segment1-select">
                                    <option value="所有价位段">所有价位段</option>
                                </select>
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">价位段2</label>
                                <select class="form-select" id="segment2-select">
                                    <option value="所有价位段">所有价位段</option>
                                </select>
                            </div>
                        </div>
                        <div class="mb-3 mt-3">
                            <label class="form-label">输入档位</label>
                            <input type="text" class="form-control" id="compare-levels" placeholder="例如: 27,28,29">
                        </div>
                        <button class="btn btn-warning" onclick="compareSegments()">
                            <i class="fas fa-balance-scale me-1"></i>对比
                        </button>
                    </div>
                </div>
            </div>
            
            <div class="col-lg-6 mb-4">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">
                            <i class="fas fa-exchange-alt me-2"></i>档位对比
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-6">
                                <label class="form-label">档位1</label>
                                <input type="number" class="form-control" id="grade1-input" placeholder="例如: 27">
                            </div>
                            <div class="col-md-6">
                                <label class="form-label">档位2</label>
                                <input type="number" class="form-control" id="grade2-input" placeholder="例如: 28">
                            </div>
                        </div>
                        <button class="btn btn-info mt-3" onclick="compareGrades()">
                            <i class="fas fa-exchange-alt me-1"></i>对比
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 结果显示区域 -->
        <div class="row">
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <h5 class="card-title mb-0">
                            <i class="fas fa-table me-2"></i>查询结果
                        </h5>
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-striped table-hover" id="results-table">
                                <thead id="results-header">
                                    <tr><th>请先上传数据文件并执行查询</th></tr>
                                </thead>
                                <tbody id="results-body">
                                </tbody>
                            </table>
                        </div>
                        <div id="results-summary" class="mt-3">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let jwdcxData = [];
        let priceData = [];
        let inputData = [];

        async function uploadFile(input, type) {
            const file = input.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', type);

            const statusDiv = document.getElementById(`${type}-status`);
            statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 上传中...';

            try {
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();

                if (response.ok) {
                    statusDiv.innerHTML = `<i class="fas fa-check-circle text-success"></i> ${result.message}`;
                    
                    if (type === 'jwdcx') {
                        updateSegmentSelects(result.segments);
                    }
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                statusDiv.innerHTML = `<i class="fas fa-exclamation-circle text-danger"></i> ${error.message}`;
            }
        }

        async function loadSegments() {
            try {
                const response = await fetch('/api/segments');
                const result = await response.json();
                updateSegmentSelects(result.segments);
            } catch (error) {
                console.error('加载价位段失败:', error);
            }
        }

        function updateSegmentSelects(segments) {
            const selects = ['segment-select', 'segment1-select', 'segment2-select'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                select.innerHTML = '';
                segments.forEach(segment => {
                    const option = document.createElement('option');
                    option.value = segment;
                    option.textContent = segment;
                    select.appendChild(option);
                });
            });
        }

        async function querySegment() {
            const segment = document.getElementById('segment-select').value;
            const levelsText = document.getElementById('segment-levels').value;
            const levels = levelsText ? levelsText.split(',').map(l => l.trim()) : [];

            try {
                const response = await fetch('/api/query/segment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ segment, levels })
                });

                const result = await response.json();
                displayResults(result.data, [
                    { key: '商品', label: '商品' },
                    { key: '可定量', label: '可定量' },
                    { key: '上限', label: '上限' },
                    { key: '价位段', label: '价位段' }
                ]);
            } catch (error) {
                alert('查询失败: ' + error.message);
            }
        }

        async function queryGrade() {
            const grade = document.getElementById('grade-input').value;
            if (!grade) return alert('请输入档位');

            try {
                const response = await fetch('/api/query/grade', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grade: parseInt(grade) })
                });

                const result = await response.json();
                displayResults(result.data, [
                    { key: '规格名称', label: '规格' },
                    { key: '条数', label: '条数' },
                    { key: '批发价', label: '批发价' },
                    { key: '金额', label: '金额' }
                ]);
            } catch (error) {
                alert('查询失败: ' + error.message);
            }
        }

        async function compareSegments() {
            const segment1 = document.getElementById('segment1-select').value;
            const segment2 = document.getElementById('segment2-select').value;
            const levelsText = document.getElementById('compare-levels').value;
            const levels = levelsText ? levelsText.split(',').map(l => l.trim()) : [];

            try {
                const response = await fetch('/api/compare/segments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ segment1, segment2, levels })
                });

                const result = await response.json();
                displayResults(result.data, [
                    { key: '商品', label: '商品' },
                    { key: '档位', label: '档位' },
                    { key: '可定量_1', label: '价位段1可定量' },
                    { key: '可定量_2', label: '价位段2可定量' },
                    { key: '可定量差异', label: '可定量差异' }
                ]);
            } catch (error) {
                alert('对比失败: ' + error.message);
            }
        }

        async function compareGrades() {
            const grade1 = document.getElementById('grade1-input').value;
            const grade2 = document.getElementById('grade2-input').value;
            if (!grade1 || !grade2) return alert('请输入两个档位');

            try {
                const response = await fetch('/api/compare/grades', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ grade1: parseInt(grade1), grade2: parseInt(grade2) })
                });

                const result = await response.json();
                displayResults(result.data, [
                    { key: '规格名称', label: '规格' },
                    { key: `条数_${grade1}`, label: `档位${grade1}条数` },
                    { key: `条数_${grade2}`, label: `档位${grade2}条数` },
                    { key: '差异', label: '差异' },
                    { key: `金额_${grade1}`, label: `档位${grade1}金额` },
                    { key: `金额_${grade2}`, label: `档位${grade2}金额` },
                    { key: '金额差异', label: '金额差异' }
                ]);
            } catch (error) {
                alert('对比失败: ' + error.message);
            }
        }

        function displayResults(data, columns) {
            const header = document.getElementById('results-header');
            const body = document.getElementById('results-body');
            
            if (!data || data.length === 0) {
                header.innerHTML = '<tr><th colspan="100" class="text-center">没有找到数据</th></tr>';
                body.innerHTML = '';
                return;
            }
            
            header.innerHTML = columns.map(col => `<th>${col.label}</th>`).join('');
            body.innerHTML = data.map(item => {
                const row = columns.map(col => {
                    let value = item[col.key];
                    if (typeof value === 'number') {
                        if (col.key.includes('差异') || col.key.includes('金额')) {
                            return `<td class="${value > 0 ? 'positive-diff' : value < 0 ? 'negative-diff' : ''}">${value.toFixed(2)}</td>`;
                        }
                        return `<td>${Math.round(value)}</td>`;
                    }
                    return `<td>${value || ''}</td>`;
                }).join('');
                return `<tr>${row}</tr>`;
            }).join('');
        }

        // 页面加载时初始化
        loadSegments();
    </script>
</body>
</html>`;
}