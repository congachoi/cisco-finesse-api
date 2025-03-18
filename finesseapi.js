require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const xml2js = require('xml2js');

const app = express();
const port = 3000;

// Cấu hình từ biến môi trường
const CONFIG = {
  FINESSE_HOST: process.env.FINESSE_HOST || '198.18.133.16',
  FINESSE_PORT: process.env.FINESSE_PORT || 8445,
  ADMIN_USERNAME: process.env.FINESSE_USER || 'administrator',
  ADMIN_PASSWORD: process.env.FINESSE_PASS || 'C1sco12345'
};

// Tắt kiểm tra SSL (chỉ dùng thử nghiệm)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Lưu trạng thái agent
let agents = {};

// Chuyển đổi XML sang JSON
async function parseXmlToJson(xmlData) {
  try {
    const parser = new xml2js.Parser({ explicitArray: false });
    return await parser.parseStringPromise(xmlData);
  } catch (error) {
    console.error('Error parsing XML:', error.message);
    return null;
  }
}

// Lấy thông tin cuộc gọi của agent (chỉ khi trạng thái là "TALKING")
async function getCallId(agentId) {
  try {
    const url = `https://${CONFIG.FINESSE_HOST}:${CONFIG.FINESSE_PORT}/finesse/api/User/${agentId}/Dialogs`;

    const response = await axios.get(url, {
      auth: {
        username: CONFIG.ADMIN_USERNAME,
        password: CONFIG.ADMIN_PASSWORD
      },
      httpsAgent
    });

    const result = await parseXmlToJson(response.data);

    if (result?.Dialogs?.Dialog) {
      const dialog = result.Dialogs.Dialog;

      return {
        callId: dialog.id || 'N/A',
        fromNumber: dialog.fromAddress || 'N/A',
        toNumber: dialog.toAddress || 'N/A'
      };
    } else {
      return { callId: 'N/A', fromNumber: 'N/A', toNumber: 'N/A' };
    }
  } catch (error) {
    console.error(`Error fetching call info for ${agentId}:`, error.message);
    return { callId: 'N/A', fromNumber: 'N/A', toNumber: 'N/A' };
  }
}

// Lấy danh sách agents từ Finesse
async function getAllAgents() {
  try {
    console.log('Fetching agents...');
    const response = await axios.get(
      `https://${CONFIG.FINESSE_HOST}:${CONFIG.FINESSE_PORT}/finesse/api/Users`,
      {
        auth: {
          username: CONFIG.ADMIN_USERNAME,
          password: CONFIG.ADMIN_PASSWORD
        },
        httpsAgent
      }
    );

    const parsedData = await parseXmlToJson(response.data);
    if (!parsedData?.Users?.User) {
      console.warn('No users found in response');
      return;
    }

    const users = Array.isArray(parsedData.Users.User) ? parsedData.Users.User : [parsedData.Users.User];

    for (const user of users) {
      let callInfo = { callId: 'N/A', fromNumber: 'N/A', toNumber: 'N/A' };

      // Nếu trạng thái là "TALKING", lấy thông tin cuộc gọi
      if (user.state === "TALKING") {
        callInfo = await getCallId(user.loginId);
      }

      agents[user.loginId] = {
        loginId: user.loginId,
        extension: user.extension || 'N/A',
        state: user.state || 'UNKNOWN',
        callId: callInfo.callId,
        fromNumber: callInfo.fromNumber,
        toNumber: callInfo.toNumber,
        lastUpdate: new Date().toISOString()
      };
    }

    console.log('Updated agents:', agents);
  } catch (error) {
    console.error('Error fetching agents:', error.message);
  }
}

// Cập nhật trạng thái mỗi 2 giây
setInterval(getAllAgents, 2000);

// API endpoint để lấy danh sách agent
app.get('/agents', (req, res) => {
  res.json(Object.values(agents));
});

// Giao diện Web hiển thị trạng thái
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Finesse Agent Monitor</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; }
        table { width: 80%; margin: auto; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid black; }
        th { background-color: #4CAF50; color: white; }
        .READY { background-color: #8BC34A; }
        .NOT_READY { background-color: #FF7043; }
        .TALKING { background-color: #FFC107; }
        .UNKNOWN { background-color: #BDBDBD; }
      </style>
      <script>
        async function fetchAgents() {
          const response = await fetch('/agents');
          const agents = await response.json();
          let html = '<h1>Finesse Agent Monitor</h1>';
          html += '<table><tr><th>Agent ID</th><th>Extension</th><th>State</th><th>Call ID</th><th>From</th><th>To</th><th>Last Update</th></tr>';
          agents.forEach(agent => {
            html += \`<tr class="\${agent.state}">
              <td>\${agent.loginId}</td>
              <td>\${agent.extension}</td>
              <td>\${agent.state}</td>
              <td>\${agent.callId}</td>
              <td>\${agent.fromNumber}</td>
              <td>\${agent.toNumber}</td>
              <td>\${agent.lastUpdate}</td>
            </tr>\`;
          });
          html += '</table>';
          document.getElementById('content').innerHTML = html;
        }
        setInterval(fetchAgents, 1000);
        window.onload = fetchAgents;
      </script>
    </head>
    <body>
      <div id="content">Loading...</div>
    </body>
    </html>
  `);
});

// Chạy server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
