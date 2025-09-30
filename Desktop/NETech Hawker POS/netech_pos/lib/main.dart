import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'firebase_options_prod.dart' as prod; // ← prod options
import 'app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: prod.DefaultFirebaseOptions.currentPlatform,
  );
  // Optional (web): keep users signed in across refresh
  // if (kIsWeb) await FirebaseAuth.instance.setPersistence(Persistence.LOCAL);

  runApp(const MyApp());
}
