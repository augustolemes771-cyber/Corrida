package com.driverhub.motorista;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Ponte entre o painel (página) e o serviço nativo do modo online. */
@CapacitorPlugin(
        name = "Rastreio",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        }
)
public class RastreioPlugin extends Plugin {

    @PluginMethod
    public void iniciar(PluginCall call) {
        android.util.Log.i(RastreioService.TAG, "iniciar: location=" + getPermissionState("location") + " notifications=" + getPermissionState("notifications"));
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[]{"location", "notifications"}, call, "depoisDaPermissao");
            return;
        }
        if (getPermissionState("notifications") != PermissionState.GRANTED && android.os.Build.VERSION.SDK_INT >= 33) {
            // Sem isso a notificação fixa fica escondida, mas o envio funciona
            requestPermissionForAlias("notifications", call, "depoisDaPermissao");
            return;
        }
        ligar(call);
    }

    @PermissionCallback
    private void depoisDaPermissao(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) ligar(call);
        else call.reject("Sem permissão de localização.", "NOT_AUTHORIZED");
    }

    private void ligar(PluginCall call) {
        android.util.Log.i(RastreioService.TAG, "ligar serviço");
        String url = call.getString("url");
        if (url == null) {
            call.reject("Faltou o endereço do servidor.");
            return;
        }
        Intent i = new Intent(getContext(), RastreioService.class).putExtra("url", url);
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("O Android não deixou ligar o modo online: " + e.getMessage());
        }
    }

    @PluginMethod
    public void parar(PluginCall call) {
        getContext().stopService(new Intent(getContext(), RastreioService.class));
        call.resolve();
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ativo", RastreioService.ativo);
        call.resolve(r);
    }

    @PluginMethod
    public void abrirConfiguracoes(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
