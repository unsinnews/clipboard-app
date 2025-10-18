// Durable Object 类
export class ClipboardDurable {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Set();
    this.clipboardContent = '';
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket 升级请求
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      await this.handleSession(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // HTTP API 端点
    if (url.pathname === '/api/get') {
      return new Response(JSON.stringify({
        content: this.clipboardContent,
        timestamp: Date.now()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/api/set' && request.method === 'POST') {
      const data = await request.json();
      this.clipboardContent = data.content || '';
      
      // 广播给所有连接的客户端
      this.broadcast({
        type: 'update',
        content: this.clipboardContent,
        timestamp: Date.now()
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    this.sessions.add(webSocket);

    // 发送当前内容给新连接
    webSocket.send(JSON.stringify({
      type: 'init',
      content: this.clipboardContent,
      timestamp: Date.now()
    }));

    webSocket.addEventListener('message', async (msg) => {
      try {
        const data = JSON.parse(msg.data);
        
        if (data.type === 'update') {
          this.clipboardContent = data.content;
          // 广播给所有其他客户端
          this.broadcast({
            type: 'update',
            content: this.clipboardContent,
            timestamp: Date.now()
          }, webSocket);
        }
      } catch (err) {
        webSocket.send(JSON.stringify({ 
          type: 'error', 
          message: err.message 
        }));
      }
    });

    webSocket.addEventListener('close', () => {
      this.sessions.delete(webSocket);
    });

    webSocket.addEventListener('error', () => {
      this.sessions.delete(webSocket);
    });
  }

  broadcast(message, excludeSocket = null) {
    const messageStr = JSON.stringify(message);
    this.sessions.forEach(socket => {
      if (socket !== excludeSocket && socket.readyState === 1) {
        socket.send(messageStr);
      }
    });
  }
}

// Worker 入口
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 获取 Durable Object 实例
    const id = env.CLIPBOARD.idFromName('global-clipboard');
    const stub = env.CLIPBOARD.get(id);

    return stub.fetch(request);
  }
};
