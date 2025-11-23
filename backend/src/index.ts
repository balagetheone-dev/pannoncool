import { D1Database } from '@cloudflare/workers-types';
import { storage } from './storage';

export interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Encrypted-Yw-ID, X-Is-Login, X-Yw-Env, X-Project-Id',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/upload-url' && method === 'POST') {
        return await handleUploadUrl(request, env);
      }

      if (path === '/api/download-url' && method === 'POST') {
        return await handleDownloadUrl(request, env);
      }
      
      if (path === '/api/users' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM users WHERE deleted = 0').all();
        return jsonResponse(results);
      }

      if (path === '/api/users' && method === 'POST') {
        const user = await request.json() as any;
        // Check if user exists
        const existing = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(user.id).first();
        if (existing) {
          await env.DB.prepare('UPDATE users SET name = ?, email = ?, role = ?, pin = ?, profile_image = ? WHERE id = ?')
            .bind(user.name, user.email, user.role, user.pin, user.profileImage, user.id).run();
        } else {
          await env.DB.prepare('INSERT INTO users (id, name, email, role, pin, profile_image) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(user.id, user.name, user.email, user.role, user.pin, user.profileImage).run();
        }
        return jsonResponse({ success: true });
      }

      if (path.startsWith('/api/users/') && method === 'DELETE') {
        const id = path.split('/').pop();
        await env.DB.prepare('UPDATE users SET deleted = 1 WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true });
      }

      if (path === '/api/clients' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM clients').all();
        return jsonResponse(results);
      }

      if (path === '/api/locations' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM locations').all();
        return jsonResponse(results);
      }

      if (path === '/api/assets' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM assets').all();
        return jsonResponse(results);
      }

      if (path === '/api/materials' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM materials').all();
        return jsonResponse(results);
      }

      if (path === '/api/work-orders' && method === 'GET') {
        // Join with clients and locations for list view
        const { results } = await env.DB.prepare(`
          SELECT wo.*, c.name as client_name, l.address as location_address 
          FROM work_orders wo
          LEFT JOIN clients c ON wo.client_id = c.id
          LEFT JOIN locations l ON wo.location_id = l.id
          ORDER BY wo.created_at DESC
        `).all();
        
        // Fetch assigned technicians for each work order
        // This is N+1 but okay for small lists. For larger, we'd do a join or separate query.
        // For simplicity in MVP, we'll just return the basic info and fetch details on detail page.
        return jsonResponse(results);
      }

      if (path.startsWith('/api/work-orders/') && method === 'GET') {
        const id = path.split('/').pop();
        if (!id) return errorResponse('ID required', 400);

        const wo = await env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first();
        if (!wo) return errorResponse('Work order not found', 404);

        // Fetch related data
        const items = await env.DB.prepare('SELECT * FROM work_order_items WHERE work_order_id = ?').bind(id).all();
        const tasks = await env.DB.prepare('SELECT * FROM work_order_tasks WHERE work_order_id = ?').bind(id).all();
        const photos = await env.DB.prepare('SELECT * FROM work_order_photos WHERE work_order_id = ?').bind(id).all();
        const technicians = await env.DB.prepare(`
          SELECT u.* FROM users u
          JOIN work_order_technicians wot ON u.id = wot.user_id
          WHERE wot.work_order_id = ?
        `).bind(id).all();

        return jsonResponse({
          ...wo,
          items: items.results,
          tasks: tasks.results,
          photos: photos.results,
          assignedTechnicians: technicians.results
        });
      }

      if (path === '/api/work-orders' && method === 'POST') {
        const data = await request.json() as any;
        // Implementation for creating work order
        // This requires multiple inserts (wo, items, tasks, technicians)
        // Using batch
        const id = crypto.randomUUID();
        const stmts = [
          env.DB.prepare(`
            INSERT INTO work_orders (id, work_order_number, client_id, location_id, asset_id, status, work_type, description, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(id, data.workOrderNumber, data.clientId, data.locationId, data.assetId, data.status, data.workType, data.description, data.priority, new Date().toISOString())
        ];

        // Add technicians
        if (data.assignedTechnicians && Array.isArray(data.assignedTechnicians)) {
          for (const tech of data.assignedTechnicians) {
            stmts.push(env.DB.prepare('INSERT INTO work_order_technicians (work_order_id, user_id) VALUES (?, ?)').bind(id, tech.id));
          }
        }

        await env.DB.batch(stmts);
        return jsonResponse({ id, success: true });
      }

      if (path.startsWith('/api/work-orders/') && method === 'PUT') {
        const id = path.split('/').pop();
        const data = await request.json() as any;
        
        // Update main fields
        // This is a simplified update, in reality we might need to handle relations carefully
        await env.DB.prepare(`
          UPDATE work_orders SET 
            status = ?, 
            work_type = ?, 
            description = ?, 
            priority = ?, 
            started_at = ?, 
            finished_at = ?, 
            failure_date = ?, 
            signature_url = ?, 
            signature_gps_lat = ?, 
            signature_gps_lon = ?, 
            signature_gps_accuracy = ?, 
            travel_distance = ?
          WHERE id = ?
        `).bind(
          data.status, data.workType, data.description, data.priority, 
          data.startedAt, data.finishedAt, data.failureDate, 
          data.signatureUrl, data.signatureGpsLat, data.signatureGpsLon, data.signatureGpsAccuracy, 
          data.travelDistance, id
        ).run();

        // Handle photos (insert new ones)
        if (data.newPhotos && Array.isArray(data.newPhotos)) {
           const photoStmts = data.newPhotos.map((p: any) => 
             env.DB.prepare('INSERT INTO work_order_photos (id, work_order_id, url, timestamp, gps_lat, gps_lon, type) VALUES (?, ?, ?, ?, ?, ?, ?)')
             .bind(crypto.randomUUID(), id, p.url, p.timestamp, p.gpsLat, p.gpsLon, p.type || 'work_photo')
           );
           if (photoStmts.length > 0) await env.DB.batch(photoStmts);
        }

        return jsonResponse({ success: true });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error: any) {
      return errorResponse(error.message, 500);
    }
  }
};

async function handleUploadUrl(request: Request, env: Env) {
  const body = await request.json() as { filename: string, contentType?: string };
  const { filename, contentType } = body;
  
  const data = await storage.getUploadUrl(filename, contentType || 'application/octet-stream');
  return jsonResponse(data);
}

async function handleDownloadUrl(request: Request, env: Env) {
  const body = await request.json() as { key: string };
  const { key } = body;
  
  const data = await storage.getDownloadUrl(key);
  return jsonResponse(data);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function errorResponse(message: string, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
