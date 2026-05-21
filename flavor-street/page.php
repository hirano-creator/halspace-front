<?php
/**
 * 汎用固定ページテンプレート
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">
	<section class="fs-page-hero fs-page-hero--compact">
		<div class="fs-page-hero__bg">
			<?php if ( has_post_thumbnail() ) : ?>
				<?php the_post_thumbnail( 'fs-hero', array( 'class' => 'fs-page-hero__image' ) ); ?>
			<?php endif; ?>
			<div class="fs-page-hero__overlay fs-page-hero__overlay--light"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<h1 class="fs-page-hero__title"><?php the_title(); ?></h1>
		</div>
	</section>

	<article class="fs-page fs-section">
		<div class="fs-container">
			<div class="fs-page__content">
				<?php
				while ( have_posts() ) :
					the_post();
					the_content();
				endwhile;
				?>
			</div>
		</div>
	</article>
</main>

<?php get_footer(); ?>
