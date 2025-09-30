import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

class ClaimsTestPage extends StatefulWidget {
  const ClaimsTestPage({super.key});

  @override
  State<ClaimsTestPage> createState() => _ClaimsTestPageState();
}

class _ClaimsTestPageState extends State<ClaimsTestPage> {
  final _auth = FirebaseAuth.instance;

  // ⬇️ Replace with the real staging passwords you used when creating users
  static const _adminNE001 = ('admin@ne001.com', 'password123');
  static const _staffTP01 = ('staff@tp01.com', 'password123');
  static const _adminNE002 = ('admin@ne002.com', 'password123');

  String _status = 'Idle';
  String _claims = '—';
  User? get _user => _auth.currentUser;

  Future<void> _signIn(String email, String pass) async {
    setState(() {
      _status = 'Signing in…';
      _claims = '—';
    });
    try {
      await _auth.signInWithEmailAndPassword(
        email: email,
        password: pass,
      );
      // Force-refresh the ID token so latest claims are included
      final token = await _auth.currentUser!.getIdTokenResult(
        true,
      );
      setState(() {
        _status = 'Signed in as $email';
        _claims = token.claims?.toString() ?? '{}';
      });
    } catch (e) {
      setState(() => _status = 'Sign-in error: $e');
    }
  }

  Future<void> _loadClaims() async {
    final user = _auth.currentUser;
    if (user == null) {
      setState(() {
        _status = 'No user signed in';
        _claims = '—';
      });
      return;
    }
    try {
      final token = await user.getIdTokenResult(true);
      setState(() {
        _status =
            'Claims refreshed for ${user.email ?? user.uid}';
        _claims = token.claims?.toString() ?? '{}';
      });
    } catch (e) {
      setState(() => _status = 'Load claims error: $e');
    }
  }

  Future<void> _signOut() async {
    await _auth.signOut();
    setState(() {
      _status = 'Signed out';
      _claims = '—';
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    return Scaffold(
      appBar: AppBar(title: const Text('Claims Tester')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            Text(
              'Status: $_status',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'User: ${user?.email ?? user?.uid ?? '—'}',
              style: const TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 12),
            const Text(
              'Claims:',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                border: Border.all(color: Colors.black12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                _claims,
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            ),
            const SizedBox(height: 20),

            // --- Sign-in buttons
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ElevatedButton.icon(
                  icon: const Icon(Icons.login),
                  onPressed:
                      () => _signIn(
                        _adminNE001.$1,
                        _adminNE001.$2,
                      ),
                  label: const Text('Sign in Admin NE001'),
                ),
                ElevatedButton.icon(
                  icon: const Icon(Icons.login),
                  onPressed:
                      () =>
                          _signIn(_staffTP01.$1, _staffTP01.$2),
                  label: const Text('Sign in Staff TP01'),
                ),
                ElevatedButton.icon(
                  icon: const Icon(Icons.login),
                  onPressed:
                      () => _signIn(
                        _adminNE002.$1,
                        _adminNE002.$2,
                      ),
                  label: const Text('Sign in Admin NE002'),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // --- Actions
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  icon: const Icon(Icons.refresh),
                  onPressed: _loadClaims,
                  label: const Text('Load / Refresh Claims'),
                ),
                OutlinedButton.icon(
                  icon: const Icon(Icons.logout),
                  onPressed: _signOut,
                  label: const Text('Sign out'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
