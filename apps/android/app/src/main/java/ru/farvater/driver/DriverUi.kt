package ru.farvater.driver

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser as VectorParser
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

internal val Ink = Color(0xFF112E3C)
internal val Mint = Color(0xFF91E7D4)
internal val Light =
    lightColorScheme(
        tertiary = Color(0xFF68418B),
        onTertiary = Color.White,
        tertiaryContainer = Color(0xFFF1E7FA),
        onTertiaryContainer = Color(0xFF392350),
        primary = Color(0xFF2059B5),
        onPrimary = Color.White,
        primaryContainer = Color(0xFFDFEBFF),
        onPrimaryContainer = Color(0xFF11376E),
        secondary = Color(0xFF00675C),
        onSecondary = Color.White,
        secondaryContainer = Color(0xFFD4F4EA),
        onSecondaryContainer = Color(0xFF064D45),
        background = Color(0xFFF3F6F6),
        onBackground = Color(0xFF142D38),
        surface = Color.White,
        onSurface = Color(0xFF142D38),
        surfaceVariant = Color(0xFFEAF0F0),
        onSurfaceVariant = Color(0xFF475D65),
        outline = Color(0xFF70858A),
        outlineVariant = Color(0xFFCEDBDA),
        error = Color(0xFFA02D2A),
        errorContainer = Color(0xFFFFE9E6),
        onErrorContainer = Color(0xFF7B211F),
    )
internal val Dark =
    darkColorScheme(
        tertiary = Color(0xFFD7B8F5),
        onTertiary = Color(0xFF38224C),
        tertiaryContainer = Color(0xFF452E59),
        onTertiaryContainer = Color(0xFFF2E3FF),
        primary = Color(0xFFA8C9FF),
        onPrimary = Color(0xFF06316A),
        primaryContainer = Color(0xFF183D68),
        onPrimaryContainer = Color(0xFFDCEAFF),
        secondary = Color(0xFF8DDFCC),
        onSecondary = Color(0xFF003B34),
        secondaryContainer = Color(0xFF17453F),
        onSecondaryContainer = Color(0xFFA7F0DC),
        background = Color(0xFF0D191F),
        onBackground = Color(0xFFE4F0F0),
        surface = Color(0xFF16272E),
        onSurface = Color(0xFFE4F0F0),
        surfaceVariant = Color(0xFF24383E),
        onSurfaceVariant = Color(0xFFB7CACD),
        outline = Color(0xFF869C9E),
        outlineVariant = Color(0xFF3F555A),
        error = Color(0xFFFFB4AA),
        errorContainer = Color(0xFF532C2A),
        onErrorContainer = Color(0xFFFFD9D4),
    )

internal enum class Mark(val shape: String) {
    Shift("M5 6h14v15H5z M9 6V3h6v3 M8 11h8 M8 15h5"),
    Route(
        "M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7"
    ),
    Stock("M4 8l8-4 8 4v10l-8 4-8-4z M4 8l8 4 8-4 M12 12v10 M8 6l8 4"),
    Person("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 6 0 0 1 16 0v2"),
    Calendar("M4 6h16v15H4z M8 3v6 M16 3v6 M4 11h16"),
    Arrow("M5 12h14 M13 6l6 6-6 6"),
    Back("M19 12H5 M11 6l-6 6 6 6"),
    Chevron("M9 5l7 7-7 7"),
    Down("M6 9l6 6 6-6"),
    Refresh("M20 10a8 8 0 0 0-14-4L3 9 M3 4v5h5 M4 14a8 8 0 0 0 14 4l3-3 M21 20v-5h-5"),
    Time("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v6l4 2"),
    Pin("M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4"),
    Phone("M5 3h3l2 5-2 2a13 13 0 0 0 6 6l2-2 5 2v3c0 2-3 3-5 2C9 19 5 15 3 8c-1-2 0-5 2-5z"),
    Check("M4 12l5 5L20 6"),
    Info("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v5 M12 8v0.1"),
    Van(
        "M3 6h12v10H3z M15 9h4l3 4v3h-7 M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4"
    ),
    Lock("M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3"),
    Cash("M3 6h18v12H3z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"),
    Plus("M12 5v14 M5 12h14"),
    Close("M6 6l12 12 M18 6L6 18"),
    Flag("M5 21V4c5-4 9 4 15 0v9c-6 4-10-4-15 0"),
    Bell("M5 16h14l-2-4V8a5 5 0 0 0-10 0v4z M10 20h4"),
    Eye("M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4"),
}

@Composable
internal fun Symbol(
    mark: Mark,
    label: String? = null,
    color: Color = LocalContentColor.current,
    size: Int = 22,
) {
    val image =
        remember(mark) {
            ImageVector.Builder(mark.name, 24.dp, 24.dp, 24f, 24f)
                .apply {
                    addPath(
                        VectorParser().parsePathString(mark.shape).toNodes(),
                        stroke = SolidColor(Color.Black),
                        strokeLineWidth = 1.8f,
                        strokeLineCap = StrokeCap.Round,
                        strokeLineJoin = StrokeJoin.Round,
                    )
                }
                .build()
        }
    Icon(image, label, Modifier.size(size.dp), tint = color)
}

@Composable
internal fun Wordmark(onDark: Boolean = false) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Surface(shape = RoundedCornerShape(9.dp), color = if (onDark) Mint else Ink) {
            Box(Modifier.size(31.dp), contentAlignment = Alignment.Center) {
                Symbol(Mark.Route, color = if (onDark) Ink else Mint, size = 20)
            }
        }
        Text(
            "ФАРВАТЕР",
            fontSize = 15.sp,
            letterSpacing = 1.sp,
            fontWeight = FontWeight.Bold,
            color = if (onDark) Color.White else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
internal fun Heading(title: String, large: Boolean = false) {
    Text(
        title,
        modifier = Modifier.semantics { heading() },
        fontSize = if (large) 32.sp else 21.sp,
        lineHeight = if (large) 37.sp else 27.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.5).sp,
    )
}

@Composable
internal fun withMetrics(value: String, tint: Color = MaterialTheme.colorScheme.tertiary) =
    buildAnnotatedString {
        append(value)
        val units =
            Regex("""[+−-]?\d[\d\u00a0\u202f ]*(?:[,.]\d+)?\s*(?:₽|бут\.|шт\.|кг|км|ч\b|мин\b|точ\.)""")
        units.findAll(value).forEach { m ->
            addStyle(
                SpanStyle(color = tint, fontWeight = FontWeight.SemiBold),
                m.range.first,
                m.range.last + 1,
            )
        }
    }

@Composable
internal fun Muted(text: String) {
    Text(
        withMetrics(text),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
internal fun CardBlock(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

@Composable
internal fun Action(
    label: String,
    enabled: Boolean = true,
    icon: Mark = Mark.Arrow,
    click: () -> Unit,
) {
    Button(
        onClick = click,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        shape = RoundedCornerShape(13.dp),
    ) {
        Text(
            label,
            Modifier.weight(1f),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier.width(8.dp))
        Symbol(icon)
    }
}

@Composable
internal fun Setting(
    mark: Mark,
    title: String,
    detail: String = "",
    enabled: Boolean = true,
    click: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Button, onClick = click)
            .heightIn(min = 54.dp)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Symbol(mark, color = MaterialTheme.colorScheme.secondary)
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            if (detail.isNotBlank()) Muted(detail)
        }
        Symbol(Mark.Chevron, size = 16, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun PairLine(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            withMetrics(value),
            modifier = Modifier.widthIn(max = 180.dp),
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
internal fun Feedback(text: String, error: Boolean = false) {
    val colors = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = if (error) colors.errorContainer else colors.secondaryContainer,
        contentColor = if (error) colors.onErrorContainer else colors.onSecondaryContainer,
    ) {
        Row(
            Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }.padding(13.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Symbol(if (error) Mark.Info else Mark.Check, size = 19)
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
internal fun FormPage(
    title: String,
    action: String,
    onDismiss: () -> Unit,
    confirm: () -> Unit,
    enabled: Boolean = true,
    error: String = "",
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                Modifier.fillMaxSize().safeDrawingPadding().imePadding(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(
                    Modifier.fillMaxWidth().widthIn(max = 600.dp).padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) { Symbol(Mark.Back, "Назад") }
                    Text(
                        title,
                        Modifier.weight(1f).semantics { heading() },
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(
                    Modifier.weight(1f)
                        .widthIn(max = 600.dp)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    content = content,
                )
                Column(
                    Modifier.widthIn(max = 600.dp)
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (error.isNotBlank()) Feedback(error, true)
                    Action(action, enabled, Mark.Check, confirm)
                }
            }
        }
    }
}

internal fun displayDay(date: String): String =
    runCatching {
            LocalDate.parse(date)
                .format(DateTimeFormatter.ofPattern("d MMMM", Locale.forLanguageTag("ru")))
        }
        .getOrDefault(date)
