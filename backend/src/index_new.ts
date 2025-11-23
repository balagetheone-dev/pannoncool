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
        const id = crypto.randomUUID();
        const stmts = [
          env.DB.prepare(`
            INSERT INTO work_orders (id, work_order_number, client_id, location_id, asset_id, status, work_type, description, priority, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(id, data.workOrderNumber, data.clientId, data.locationId, data.assetId, data.status, data.workType, data.description, data.priority, new Date().toISOString())
        ];

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

        if (data.newPhotos && Array.isArray(data.newPhotos)) {
           const photoStmts = data.newPhotos.map((p: any) => 
             env.DB.prepare('INSERT INTO work_order_photos (id, work_order_id, url, timestamp, gps_lat, gps_lon, type) VALUES (?, ?, ?, ?, ?, ?, ?)')
             .bind(crypto.randomUUID(), id, p.url, p.timestamp, p.gpsLat, p.gpsLon, p.type || 'work_photo')
           );
           if (photoStmts.length > 0) await env.DB.batch(photoStmts);
        }

        return jsonResponse({ success: true });
      }

      // Clients
      if (path === '/api/clients' && method === 'POST') {
        const data = await request.json() as any;
        const existing = await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(data.id).first();
        if (existing) {
          await env.DB.prepare('UPDATE clients SET name = ?, type = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?')
            .bind(data.name, data.type, data.contactName, data.phone, data.email, data.address, data.notes, data.id).run();
        } else {
          await env.DB.prepare('INSERT INTO clients (id, name, type, contact_name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(data.id, data.name, data.type, data.contactName, data.phone, data.email, data.address, data.notes).run();
        }
        return jsonResponse({ success: true });
      }

      if (path.startsWith('/api/clients/') && method === 'DELETE') {
        const id = path.split('/').pop();
        await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true });
      }

      // Locations
      if (path === '/api/locations' && method === 'POST') {
        const data = await request.json() as any;
        const existing = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(data.id).first();
        if (existing) {
          await env.DB.prepare('UPDATE locations SET client_id = ?, address = ?, contact_name = ?, notes = ? WHERE id = ?')
            .bind(data.clientId, data.address, data.contactName, data.notes, data.id).run();
        } else {
          await env.DB.prepare('INSERT INTO locations (id, client_id, address, contact_name, notes) VALUES (?, ?, ?, ?, ?)')
            .bind(data.id, data.clientId, data.address, data.contactName, data.notes).run();
        }
        return jsonResponse({ success: true });
      }

      if (path.startsWith('/api/locations/') && method === 'DELETE') {
        const id = path.split('/').pop();
        await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true });
      }

      // Materials
      if (path === '/api/materials' && method === 'POST') {
        const data = await request.json() as any;
        const existing = await env.DB.prepare('SELECT id FROM materials WHERE id = ?').bind(data.id).first();
        if (existing) {
          await env.DB.prepare('UPDATE materials SET name = ?, unit = ?, price = ? WHERE id = ?')
            .bind(data.name, data.unit, data.price, data.id).run();
        } else {
          await env.DB.prepare('INSERT INTO materials (id, name, unit, price) VALUES (?, ?, ?, ?)')
            .bind(data.id, data.name, data.unit, data.price).run();
        }
        return jsonResponse({ success: true });
      }

      if (path.startsWith('/api/materials/') && method === 'DELETE') {
        const id = path.split('/').pop();
        await env.DB.prepare('DELETE FROM materials WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true });
      }

      // Vehicles
      if (path === '/api/vehicles' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM vehicles').all();
        return jsonResponse(results);
      }

      if (path === '/api/vehicles' && method === 'POST') {
        const data = await request.json() as any;
        const existing = await env.DB.prepare('SELECT id FROM vehicles WHERE id = ?').bind(data.id).first();
        if (existing) {
          await env.DB.prepare('UPDATE vehicles SET license_plate = ?, brand = ?, model = ?, assigned_user_id = ? WHERE id = ?')
            .bind(data.licensePlate, data.brand, data.model, data.assignedUserId, data.id).run();
        } else {
          await env.DB.prepare('INSERT INTO vehicles (id, license_plate, brand, model, assigned_user_id) VALUES (?, ?, ?, ?, ?)')
            .bind(data.id, data.licensePlate, data.brand, data.model, data.assignedUserId).run();
        }
        return jsonResponse({ success: true });
      }

      if (path.startsWith('/api/vehicles/') && method === 'DELETE') {
        const id = path.split('/').pop();
        await env.DB.prepare('DELETE FROM vehicles WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true });
      }

      // Vehicle Inventory
      if (path.includes('/inventory') && method === 'GET') {
        const parts = path.split('/');
        const vehicleId = parts[parts.indexOf('vehicles') + 1];
        const { results } = await env.DB.prepare('SELECT * FROM vehicle_inventory WHERE vehicle_id = ?').bind(vehicleId).all();
        return jsonResponse(results);
      }

      if (path.includes('/inventory') && method === 'POST') {
        const data = await request.json() as any;
        const existing = await env.DB.prepare('SELECT id FROM vehicle_inventory WHERE vehicle_id = ? AND material_id = ?')
          .bind(data.vehicleId, data.materialId).first();
        
        if (existing) {
          await env.DB.prepare('UPDATE vehicle_inventory SET quantity = quantity + ? WHERE id = ?')
            .bind(data.quantity, existing.id).run();
        } else {
          await env.DB.prepare('INSERT INTO vehicle_inventory (id, vehicle_id, material_id, quantity) VALUES (?, ?, ?, ?)')
            .bind(crypto.randomUUID(), data.vehicleId, data.materialId, data.quantity).run();
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
