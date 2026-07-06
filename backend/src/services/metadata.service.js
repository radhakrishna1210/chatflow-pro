import fs from 'fs';
import path from 'path';

const METADATA_FILE = path.join(process.cwd(), 'src/data/workspace_metadata.json');

// Ensure data directory exists
const dir = path.dirname(METADATA_FILE);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

function readMetadata() {
  try {
    if (!fs.existsSync(METADATA_FILE)) return {};
    const content = fs.readFileSync(METADATA_FILE, 'utf-8');
    return JSON.parse(content || '{}');
  } catch (err) {
    console.error('[MetadataService] Error reading metadata file:', err.message);
    return {};
  }
}

function writeMetadata(data) {
  try {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[MetadataService] Error writing metadata file:', err.message);
  }
}

export function getWorkspaceMetadata(workspaceId) {
  const data = readMetadata();
  if (!data[workspaceId]) {
    data[workspaceId] = {
      walletBalance: 2462.11,
      gstNum: '',
      addons: {
        crm: false,
        events: false,
        tags: false,
        fields: false
      },
      twoFactorEnabled: false
    };
    writeMetadata(data);
  }
  return data[workspaceId];
}

export function updateWorkspaceMetadata(workspaceId, updates) {
  const data = readMetadata();
  const current = getWorkspaceMetadata(workspaceId);
  data[workspaceId] = { ...current, ...updates };
  writeMetadata(data);
  return data[workspaceId];
}
