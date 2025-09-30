// lib/app.dart
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// ----------------------------------------------------------------------------
/// Simple identity models (avoid Dart record/typedef issues)
/// ----------------------------------------------------------------------------
class Staff {
  final String companyId;
  final String storeId;
  final String email;
  const Staff(this.companyId, this.storeId, this.email);
}

class AdminUser {
  final String companyId;
  final String email;
  const AdminUser(this.companyId, this.email);
}

/// ----------------------------------------------------------------------------
/// PROD test identities (claims already set in prod)
//  role: 'staff',  companyId: 'NE001', storeId: 'TP01'
const Staff kStaffTP01 = Staff(
  'NE001',
  'TP01',
  'staff@tp01.com',
);
//  role: 'admin',  companyId: 'NE001'
const AdminUser kAdminNE001 = AdminUser(
  'NE001',
  'admin@ne001.com',
);

const String kProdPassword = 'password123';

final _auth = FirebaseAuth.instance;
final _db = FirebaseFirestore.instance;

/// ----------------------------------------------------------------------------
/// App shell
/// ----------------------------------------------------------------------------
class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'CK Orders Tester (PROD)',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF6750A4),
        useMaterial3: true,
      ),
      home: const CKOrdersTesterPage(),
    );
  }
}

/// ----------------------------------------------------------------------------
/// CK Orders Tester
/// ----------------------------------------------------------------------------
class CKOrdersTesterPage extends StatefulWidget {
  const CKOrdersTesterPage({super.key});
  @override
  State<CKOrdersTesterPage> createState() =>
      _CKOrdersTesterPageState();
}

class _CKOrdersTesterPageState
    extends State<CKOrdersTesterPage> {
  String _status = 'Signed out';
  String _lastResult = '—';
  String _claimsText = '—';
  final Set<String> _selectedOrderIds = {};

  // ----------------------------- Auth helpers ------------------------------
  Future<void> _signInStaff(Staff s) async {
    try {
      await _auth.signOut();
      await _auth.signInWithEmailAndPassword(
        email: s.email,
        password: kProdPassword,
      );
      await _refreshClaims();
      setState(() {
        _status =
            'Signed in as STAFF (${s.companyId}/${s.storeId})';
        _selectedOrderIds.clear();
      });
    } catch (e) {
      setState(() => _status = 'Staff sign-in failed: $e');
    }
  }

  Future<void> _signInAdmin(AdminUser a) async {
    try {
      await _auth.signOut();
      await _auth.signInWithEmailAndPassword(
        email: a.email,
        password: kProdPassword,
      );
      await _refreshClaims();
      setState(() {
        _status = 'Signed in as ADMIN (${a.companyId})';
        _selectedOrderIds.clear();
      });
    } catch (e) {
      setState(() => _status = 'Admin sign-in failed: $e');
    }
  }

  Future<void> _signOut() async {
    await _auth.signOut();
    setState(() {
      _status = 'Signed out';
      _lastResult = '—';
      _claimsText = '—';
      _selectedOrderIds.clear();
    });
  }

  Future<void> _refreshClaims() async {
    final u = _auth.currentUser;
    if (u == null) {
      setState(() => _claimsText = '—');
      return;
    }
    final t = await u.getIdTokenResult(true);
    setState(() => _claimsText = (t.claims ?? {}).toString());
  }

  Future<Map<String, dynamic>?> _claims() async {
    final u = _auth.currentUser;
    if (u == null) return null;
    final t = await u.getIdTokenResult(true);
    return t.claims;
  }

  // ----------------------------- Staff create ------------------------------
  Future<void> _staffCreateOrder(Staff s) async {
    try {
      final c = await _claims();
      if (c == null || c['role'] != 'staff') {
        setState(() => _lastResult = 'DENIED: staff only');
        return;
      }

      // Use client Timestamp.now() to satisfy rules that require "timestamp" at write time.
      final now = Timestamp.now();

      final doc = <String, dynamic>{
        'companyId': s.companyId,
        'storeId': s.storeId,
        'items': [
          {
            'sku': 'CHICKEN_RICE',
            'name': 'Chicken Rice (CK)',
            'qty': 10,
            'note': 'no chilli',
          },
          {
            'sku': 'DUCK_RICE',
            'name': 'Duck Rice (CK)',
            'qty': 5,
          },
        ],
        'createdAt':
            now, // timestamp (not serverTimestamp sentinel)
        'createdBy': _auth.currentUser?.uid ?? 'unknown',
        'status': 'Requested',
      };

      await _db.collection('central_kitchen_orders').add(doc);
      setState(
        () => _lastResult = 'Created CK order (Requested) ✅',
      );
    } on FirebaseException catch (e) {
      setState(
        () =>
            _lastResult =
                'Create failed: ${e.message ?? e.code}',
      );
    } catch (e) {
      setState(() => _lastResult = 'Create failed: $e');
    }
  }

  // ----------------------------- Streams (orderBy to match indexes) --------
  // Staff list (companyId ASC, storeId ASC, createdAt DESC)
  Stream<QuerySnapshot<Map<String, dynamic>>> _staffMyOrders(
    Staff s,
  ) {
    return _db
        .collection('central_kitchen_orders')
        .where('companyId', isEqualTo: s.companyId)
        .where('storeId', isEqualTo: s.storeId)
        .orderBy('companyId')
        .orderBy('storeId')
        .orderBy('createdAt', descending: true)
        .snapshots();
  }

  // Admin pending (companyId ASC, status ASC, createdAt DESC)
  Stream<QuerySnapshot<Map<String, dynamic>>>
  _adminPendingStream(String companyId) {
    return _db
        .collection('central_kitchen_orders')
        .where('companyId', isEqualTo: companyId)
        .where('status', isEqualTo: 'Requested')
        .orderBy('companyId')
        .orderBy('status')
        .orderBy('createdAt', descending: true)
        .snapshots();
  }

  // ----------------------------- Admin update status -----------------------
  Future<void> _adminUpdateSelected(String newStatus) async {
    if (_selectedOrderIds.isEmpty) {
      setState(() => _lastResult = 'No orders selected.');
      return;
    }
    try {
      final batch = _db.batch();
      for (final id in _selectedOrderIds) {
        batch.update(
          _db.collection('central_kitchen_orders').doc(id),
          {'status': newStatus},
        );
      }
      await batch.commit();
      setState(() {
        _lastResult =
            'Updated ${_selectedOrderIds.length} order(s) → $newStatus ✅';
        _selectedOrderIds.clear();
      });
    } on FirebaseException catch (e) {
      setState(
        () =>
            _lastResult =
                'Admin update failed: ${e.message ?? e.code}',
      );
    } catch (e) {
      setState(() => _lastResult = 'Admin update failed: $e');
    }
  }

  // -------------------------------- UI -------------------------------------
  @override
  Widget build(BuildContext context) {
    final user = _auth.currentUser;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Central Kitchen Orders — Tester (PROD)',
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Status: $_status'),
          const SizedBox(height: 6),
          Text('User: ${user?.email ?? '—'}'),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Claims: '),
              Expanded(child: Text(_claimsText)),
              IconButton(
                tooltip: 'Refresh claims',
                onPressed: _refreshClaims,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 12),

          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              FilledButton.tonal(
                onPressed: () => _signInStaff(kStaffTP01),
                child: const Text('Sign in Staff (TP01)'),
              ),
              FilledButton.tonal(
                onPressed: () => _signInAdmin(kAdminNE001),
                child: const Text('Sign in Admin (NE001)'),
              ),
              FilledButton(
                onPressed: _signOut,
                child: const Text('Sign out'),
              ),
            ],
          ),

          const Divider(height: 32),

          const Text(
            'Staff actions (TP01)',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              FilledButton(
                onPressed: () => _staffCreateOrder(kStaffTP01),
                child: const Text('Create CK order (Requested)'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          (_auth.currentUser?.email == kStaffTP01.email)
              ? _buildStaffOrdersList(kStaffTP01)
              : const SizedBox.shrink(),

          const Divider(height: 32),

          const Text(
            'Admin actions (NE001)',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              FilledButton.tonal(
                onPressed:
                    () => setState(
                      () {},
                    ), // rebuild to ensure stream shows
                child: const Text('List pending (company)'),
              ),
              FilledButton(
                onPressed:
                    () => _adminUpdateSelected('Confirmed'),
                child: const Text('Confirm selected'),
              ),
              FilledButton.tonal(
                onPressed:
                    () => _adminUpdateSelected('Rejected'),
                child: const Text('Reject selected'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          (_auth.currentUser?.email == kAdminNE001.email)
              ? _buildAdminPendingList(kAdminNE001)
              : const SizedBox.shrink(),

          const Divider(height: 32),
          Text('Last result:\n$_lastResult'),
          const SizedBox(height: 8),
          const Text(
            'Indexes used:\n'
            '• Staff list: companyId ASC, storeId ASC, createdAt DESC\n'
            '• Admin pending: companyId ASC, status ASC, createdAt DESC\n'
            'Rules: staff can create with status="Requested"; admin can update status only.',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }

  // Staff list widget
  Widget _buildStaffOrdersList(Staff s) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _staffMyOrders(s),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(12),
            child: LinearProgressIndicator(),
          );
        }
        if (snap.hasError)
          return Text(
            'List my store orders failed: ${snap.error}',
          );
        final docs = snap.data?.docs ?? const [];
        if (docs.isEmpty)
          return const Text('No orders for this store yet.');
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('My store orders'),
            const SizedBox(height: 8),
            ...docs.map((d) {
              final data = d.data();
              final createdAt =
                  (data['createdAt'] as Timestamp?)?.toDate();
              return Card(
                child: ListTile(
                  title: Text(
                    '${data['status']} — ${data['storeId']}',
                  ),
                  subtitle: Text(
                    'createdAt: $createdAt\nitems: ${data['items']}',
                  ),
                ),
              );
            }),
          ],
        );
      },
    );
  }

  // Admin pending list widget (with multi-select)
  Widget _buildAdminPendingList(AdminUser a) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: _adminPendingStream(a.companyId),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(12),
            child: LinearProgressIndicator(),
          );
        }
        if (snap.hasError)
          return Text('List pending failed: ${snap.error}');
        final docs = snap.data?.docs ?? const [];
        if (docs.isEmpty)
          return const Text('No pending orders.');
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Pending — company ${a.companyId}'),
            const SizedBox(height: 8),
            ...docs.map((d) {
              final data = d.data();
              final id = d.id;
              final createdAt =
                  (data['createdAt'] as Timestamp?)?.toDate();
              final selected = _selectedOrderIds.contains(id);
              return Card(
                child: CheckboxListTile(
                  value: selected,
                  onChanged: (v) {
                    setState(() {
                      if (v == true) {
                        _selectedOrderIds.add(id);
                      } else {
                        _selectedOrderIds.remove(id);
                      }
                    });
                  },
                  title: Text(
                    '${data['storeId']} — ${data['status']}',
                  ),
                  subtitle: Text(
                    'id: $id\ncreatedAt: $createdAt\nitems: ${data['items']}',
                  ),
                ),
              );
            }),
          ],
        );
      },
    );
  }
}
