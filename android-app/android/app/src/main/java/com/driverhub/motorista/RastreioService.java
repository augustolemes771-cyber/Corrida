package com.driverhub.motorista;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Modo online do motorista: pega a localização e manda direto pro servidor do Driver Hub,
 * sem depender da página, que o Android congela quando o app sai da tela.
 * Roda como serviço em primeiro plano, com a notificação fixa "Driver Hub online".
 */
public class RastreioService extends Service {
    static final String TAG = "DriverHubRastreio";
    static final String CANAL = "online";
    static final int NOTIFICACAO = 7;
    static final String PREFS = "rastreio";
    static volatile boolean ativo = false;

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    private final ExecutorService rede = Executors.newSingleThreadExecutor();
    private String url;
    private long ultimoEnvio = 0;
    private Location ultimoLocal;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (intent != null && intent.getStringExtra("url") != null) {
            url = intent.getStringExtra("url");
            prefs.edit().putString("url", url).apply();
        } else {
            url = prefs.getString("url", null);
        }
        if (url == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICACAO, notificacao(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICACAO, notificacao());
            }
        } catch (Exception e) {
            // Android 14+ não deixa religar o serviço de localização vindo do segundo plano
            Log.e(TAG, "Não deu pra ficar em primeiro plano", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (callback == null) iniciarLocalizacao();
        ativo = true;
        return START_STICKY;
    }

    private void iniciarLocalizacao() {
        client = LocationServices.getFusedLocationProviderClient(this);
        LocationRequest pedido = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 15000)
                .setMinUpdateIntervalMillis(10000)
                .build();
        callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult resultado) {
                Location l = resultado.getLastLocation();
                if (l != null) talvezEnviar(l);
            }
        };
        try {
            client.requestLocationUpdates(pedido, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Sem permissão de localização", e);
            stopSelf();
        }
    }

    // Andando: no máximo a cada 25 s. Parado: um sinal por minuto, pra não sumir do mapa.
    private void talvezEnviar(Location l) {
        long agora = System.currentTimeMillis();
        long passou = agora - ultimoEnvio;
        if (ultimoLocal != null && (passou < 25000 || (passou < 60000 && l.distanceTo(ultimoLocal) < 50))) return;
        ultimoEnvio = agora;
        ultimoLocal = l;
        final String corpo = String.format(Locale.US, "{\"lat\":%.6f,\"lng\":%.6f,\"acc\":%.1f,\"speed\":%.2f,\"fonte\":\"android\"}",
                l.getLatitude(), l.getLongitude(), l.getAccuracy(), l.hasSpeed() ? l.getSpeed() : 0f);
        rede.execute(() -> enviar(corpo));
    }

    private void enviar(String corpo) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            // Mesma sessão do painel (cookie do WebView)
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            try (OutputStream o = c.getOutputStream()) {
                o.write(corpo.getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code == 401) {
                // Saiu da conta: não adianta continuar
                Log.w(TAG, "Sessão expirada, desligando o modo online");
                stopSelf();
            }
        } catch (Exception e) {
            Log.w(TAG, "Falha ao enviar localização: " + e.getMessage());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private Notification notificacao() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CANAL) == null) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Modo online", NotificationManager.IMPORTANCE_LOW);
            canal.setDescription("Aparece enquanto sua localização está ligada pros motoristas do Driver Hub.");
            nm.createNotificationChannel(canal);
        }
        Intent abrir = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent toque = PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CANAL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("Driver Hub online")
                .setContentText("Sua localização aparece pros motoristas do Driver Hub.")
                .setOngoing(true)
                .setContentIntent(toque)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    @Override
    public void onDestroy() {
        ativo = false;
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        callback = null;
        rede.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
